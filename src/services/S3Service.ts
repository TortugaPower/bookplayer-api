import {
  S3,
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  GetObjectCommandInput,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  LifecycleRule,
  StorageClass,
  TransitionStorageClass,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  ListPartsCommandOutput,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
  ListMultipartUploadsCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3ClientHeaders, StorageAction, StorageItem } from '../types/user';
import {
  INVALID_PART_LIST,
  MultipartPart,
  MultipartUploadRef,
  NO_SUCH_UPLOAD,
} from '../types/multipartUpload';
import moment from 'moment';
import { logger } from './LoggerService';
import { Readable } from 'stream';
import { stripStoragePrefix } from '../utils';

/**
 * Objects are written straight into Intelligent-Tiering instead of landing in
 * STANDARD and waiting for the bucket's `all-intelligent-tiering` rule to move
 * them. That rule stays as a backstop, but it is a poor primary mechanism: it
 * bills a transition request per object, leaves a ~3 day window where an
 * object's storage class is not what the rest of the system assumes, and never
 * fires at all for objects under 128 KB — which is why artwork accumulates in
 * STANDARD indefinitely.
 *
 * Cost-neutral on arrival — Intelligent-Tiering's Frequent Access tier is
 * priced identically to STANDARD — and cheaper once an object of 128 KB or more
 * ages into Infrequent Access. Objects below 128 KB are never monitored or
 * auto-tiered, so they stay in Frequent Access permanently: writing the class
 * directly makes those consistent, not cheaper.
 */
const WRITE_STORAGE_CLASS = StorageClass.INTELLIGENT_TIERING;

// S3 refuses a single CopyObject from a source larger than this.
const MAX_SINGLE_COPY_SIZE = 5 * 1024 * 1024 * 1024;

// SigV4's ceiling. The effective lifetime is shorter in production: URLs signed
// with the ECS task role's temporary credentials die when those rotate, which
// is why clients request part URLs just before sending each window.
const MAX_PRESIGN_SECONDS = 3600 * 24 * 7;

/**
 * Part-URL lifetime. UPLOAD_PART_URL_TTL_SECONDS exists so a device pass can
 * exercise the expired-URL path in development, and is ignored in production;
 * unset means the SigV4 maximum.
 */
const partUrlTtlSeconds = (): number => {
  if (process.env.NODE_ENV === 'production') return MAX_PRESIGN_SECONDS;
  const configured = parseInt(process.env.UPLOAD_PART_URL_TTL_SECONDS || '', 10);
  return configured > 0 ? Math.min(configured, MAX_PRESIGN_SECONDS) : MAX_PRESIGN_SECONDS;
};

// S3 reports a vanished upload as NoSuchUpload (404); the SDK exposes it on
// `name`. The bare status only counts when there is no name: a NoSuchBucket
// (a misconfigured bucket) is also a 404 and must surface as a failure, not
// as "start over".
const isNoSuchUpload = (error: { name?: string; $metadata?: { httpStatusCode?: number } }) =>
  error?.name === 'NoSuchUpload' || (!error?.name && error?.$metadata?.httpStatusCode === 404);

// A part list S3 refuses to assemble: a listed part it can't find, parts out of
// order, or a non-final part under the 5 MiB minimum.
const INVALID_PART_ERRORS = new Set(['InvalidPart', 'InvalidPartOrder', 'EntityTooSmall']);

export class S3Service {
  private readonly _logger = logger;
  private client = new S3({ region: process.env.S3_REGION });
  private clientObject = new S3Client({ region: process.env.S3_REGION });
  /**
   * Signs part URLs only. The default client (SDK 3.729+) adds
   * `x-amz-checksum-crc32` for an EMPTY body plus `x-amz-sdk-checksum-algorithm`
   * to every presigned URL. The client PUTs real bytes, to an upload created
   * with no checksum algorithm, so those parameters can only mismatch.
   */
  private partSigningClient = new S3Client({
    region: process.env.S3_REGION,
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });

  /**
   * Tri-state on purpose: true/false are definitive, null means the probe
   * could not determine it and the caller must not read that as "absent".
   *
   * A 403 is indeterminate, not absent. S3 masks a missing key as 403 only
   * when the caller lacks s3:ListBucket, and this role holds it (see
   * getDirectoryContent / calculateFolderSize, which call ListObjectsV2), so
   * a 403 here means a permission or KMS problem rather than a missing key.
   */
  async fileExists(key: string): Promise<boolean | null> {
    try {
      const data = await this.client.headObject({
        Bucket: process.env.S3_BUCKET,
        Key: key,
      });

      return data.$metadata.httpStatusCode === 200;
    } catch (error) {
      if (error.$metadata?.httpStatusCode === 404) {
        return false;
      } else if (error.$metadata?.httpStatusCode === 403) {
        // Indeterminate, not absent — see the tri-state note above. Returning
        // false here would let a permission failure read as "the object is
        // nowhere", which is how a caller ends up recording that nothing
        // exists when in fact it could not look.
        this._logger.log(
          {
            origin: 'S3Service.fileExists',
            message: 'Existence probe denied (403); treating as indeterminate',
            data: { key: stripStoragePrefix(key) },
          },
          'warn',
        );
        return null;
      } else {
        // Same level as the 403 branch: this is the wider indeterminate class
        // (5xx, timeouts, SDK failures) and it drives the same caller
        // decision, so it has to clear the production LOG_LEVEL of 'warn' too.
        this._logger.log(
          {
            origin: 'S3Service.fileExists',
            message: error.message,
            data: { key: stripStoragePrefix(key), errorName: error.name },
          },
          'warn',
        );
        return null;
      }
    }
  }

  async getDirectoryContent(
    path: string,
    isFolder = true,
  ): Promise<StorageItem[]> {
    try {
      let fixPath = path;
      if (isFolder && path[path.length - 1] !== '/') {
        fixPath = path + '/';
      }
      const objects = await this.client.listObjectsV2({
        Bucket: process.env.S3_BUCKET,
        Delimiter: '/',
        Prefix: fixPath,
      });
      const files = objects?.Contents || [];
      const folders =
        objects.CommonPrefixes?.map((pre) => {
          return {
            Key: pre.Prefix,
            Size: 0,
            isFolder: true,
          };
        }) || [];
      const content = files.concat(folders);
      return content.filter((item) => item.Key !== fixPath || !isFolder);
    } catch (err) {
      this._logger.log({
        origin: 'S3Service.getDirectoryContent',
        message: err.message,
        data: { path },
      });
      return null;
    }
  }

  async getPresignedUrl(
    key: string,
    type: StorageAction,
    bucket?: string,
  ): Promise<{
    url: string;
    expires_in: number;
  }> {
    try {
      let command;
      const obj = {
        Bucket: bucket || process.env.S3_BUCKET,
        Key: key,
      };
      switch (type) {
        case StorageAction.GET:
          command = new GetObjectCommand(obj);
          break;
        case StorageAction.PUT:
          // The SDK hoists StorageClass into the presigned URL's query string
          // rather than into SignedHeaders (which stays `host`), so clients keep
          // PUTting the URL exactly as before: no app release is required and
          // URLs already handed out stay valid.
          command = new PutObjectCommand({
            ...obj,
            StorageClass: WRITE_STORAGE_CLASS,
          });
          break;
      }
      const seconds = 3600 * 24 * 7; // 1 hour * 24 * 365 * 30 = 30 years
      const expires = moment().add(seconds, 'seconds').unix();
      const url = await getSignedUrl(this.clientObject, command, {
        expiresIn: seconds,
      });
      return { url, expires_in: expires };
    } catch (error) {
      this._logger.log({
        origin: 'S3Service.getPresignedUrl',
        message: error.message,
        data: { key, type },
      });
      return null;
    }
  }

  /**
   * Opens a multipart upload at `key`. Written straight into Intelligent-Tiering,
   * like the single-PUT path: the class is fixed at creation and every part
   * inherits it.
   */
  async createMultipartUpload(key: string): Promise<string | null> {
    try {
      const response = await this.clientObject.send(
        new CreateMultipartUploadCommand({
          Bucket: process.env.S3_BUCKET,
          Key: key,
          StorageClass: WRITE_STORAGE_CLASS,
        }),
      );
      return response.UploadId ?? null;
    } catch (error) {
      this._logger.log({
        origin: 'S3Service.createMultipartUpload',
        message: error.message,
        data: { key },
      });
      return null;
    }
  }

  /**
   * Presigns one part. Signing is local, so this can't tell whether the upload
   * still exists — a stale uploadId surfaces as NoSuchUpload on the client's PUT.
   */
  async getPresignedPartUrl(
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<{ url: string; expires_in: number } | null> {
    try {
      const seconds = partUrlTtlSeconds();
      const url = await getSignedUrl(
        this.partSigningClient,
        new UploadPartCommand({
          Bucket: process.env.S3_BUCKET,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        }),
        { expiresIn: seconds },
      );
      return { url, expires_in: moment().add(seconds, 'seconds').unix() };
    } catch (error) {
      this._logger.log({
        origin: 'S3Service.getPresignedPartUrl',
        message: error.message,
        data: { key, partNumber },
      });
      return null;
    }
  }

  /** Every part S3 holds for the upload, ascending. Paginates past 1,000. */
  async listParts(
    key: string,
    uploadId: string,
  ): Promise<MultipartPart[] | typeof NO_SUCH_UPLOAD | null> {
    try {
      const parts: MultipartPart[] = [];
      let marker: string | undefined;
      do {
        const page: ListPartsCommandOutput = await this.clientObject.send(
          new ListPartsCommand({
            Bucket: process.env.S3_BUCKET,
            Key: key,
            UploadId: uploadId,
            PartNumberMarker: marker,
          }),
        );
        for (const part of page.Parts ?? []) {
          parts.push({
            partNumber: part.PartNumber,
            size: part.Size,
            etag: part.ETag,
          });
        }
        marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
      } while (marker);
      return parts.sort((a, b) => a.partNumber - b.partNumber);
    } catch (error) {
      if (isNoSuchUpload(error)) return NO_SUCH_UPLOAD;
      this._logger.log({
        origin: 'S3Service.listParts',
        message: error.message,
        data: { key },
      });
      return null;
    }
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: MultipartPart[],
  ): Promise<true | typeof NO_SUCH_UPLOAD | typeof INVALID_PART_LIST | null> {
    try {
      await this.clientObject.send(
        new CompleteMultipartUploadCommand({
          Bucket: process.env.S3_BUCKET,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((part) => ({
              PartNumber: part.partNumber,
              ETag: part.etag,
            })),
          },
        }),
      );
      return true;
    } catch (error) {
      if (isNoSuchUpload(error)) return NO_SUCH_UPLOAD;
      if (INVALID_PART_ERRORS.has(error?.name)) return INVALID_PART_LIST;
      this._logger.log({
        origin: 'S3Service.completeMultipartUpload',
        message: error.message,
        data: { key, partCount: parts.length },
      });
      return null;
    }
  }

  /** Idempotent: an upload that is already gone counts as aborted. */
  async abortMultipartUpload(key: string, uploadId: string): Promise<boolean | null> {
    try {
      await this.clientObject.send(
        new AbortMultipartUploadCommand({
          Bucket: process.env.S3_BUCKET,
          Key: key,
          UploadId: uploadId,
        }),
      );
      return true;
    } catch (error) {
      if (isNoSuchUpload(error)) return true;
      this._logger.log({
        origin: 'S3Service.abortMultipartUpload',
        message: error.message,
        data: { key },
      });
      return null;
    }
  }

  /**
   * Every in-progress upload under `prefix`, paginated. Callers filter to the
   * keys they care about — S3 matches by prefix, so `a.m4b` also matches
   * `a.m4b.bak`.
   */
  async listMultipartUploads(prefix: string): Promise<MultipartUploadRef[] | null> {
    try {
      const uploads: MultipartUploadRef[] = [];
      let keyMarker: string | undefined;
      let uploadIdMarker: string | undefined;
      do {
        const page: ListMultipartUploadsCommandOutput = await this.clientObject.send(
          new ListMultipartUploadsCommand({
            Bucket: process.env.S3_BUCKET,
            Prefix: prefix,
            KeyMarker: keyMarker,
            UploadIdMarker: uploadIdMarker,
          }),
        );
        for (const upload of page.Uploads ?? []) {
          if (upload.Key && upload.UploadId) {
            uploads.push({ key: upload.Key, uploadId: upload.UploadId });
          }
        }
        keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
        uploadIdMarker = page.IsTruncated ? page.NextUploadIdMarker : undefined;
      } while (keyMarker);
      return uploads;
    } catch (error) {
      this._logger.log({
        origin: 'S3Service.listMultipartUploads',
        message: error.message,
        data: { prefix },
      });
      return null;
    }
  }

  async moveFile(sourceKey: string, targetKey: string): Promise<boolean> {
    // Copy-then-delete, so a failure has two very different shapes: the copy
    // never landed (bytes only at sourceKey) or the copy landed and the delete
    // did not (bytes at both). `copied` tells them apart in the log — the
    // caller only sees false either way.
    let copied = false;
    try {
      await this.clientObject.send(
        new CopyObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: targetKey,
          CopySource: `${process.env.S3_BUCKET}/${encodeURIComponent(
            sourceKey,
          )}`,
          // A copy does not inherit the source object's storage class, so
          // without this every move silently demotes an Intelligent-Tiering
          // object back to STANDARD. The tiering clock restarts either way —
          // S3 has no true rename — so this caps the cost rather than avoiding
          // it.
          StorageClass: WRITE_STORAGE_CLASS,
        }),
      );
      copied = true;
      await this.clientObject.send(
        new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: sourceKey,
        }),
      );
      return true;
    } catch (error) {
      // 'error': a failed relocation desynchronizes the DB key from the object
      // it names, so it has to survive the production LOG_LEVEL of 'warn'.
      // Keys are prefix-stripped: for legacy accounts that prefix is the user's
      // email, and this path serves exactly those accounts.
      this._logger.log(
        {
          origin: 'S3Service.moveFile',
          message: error.message,
          data: {
            sourceKey: stripStoragePrefix(sourceKey),
            targetKey: stripStoragePrefix(targetKey),
            copied,
            errorName: error.name,
          },
        },
        'error',
      );
      return false;
    }
  }

  async deleteFile(sourceKey: string): Promise<boolean> {
    try {
      /// Keep a copy for support purposes; `remove-deleted-items` expires the
      /// `deleted_` prefix after 3 days. A week was the original intent — which
      /// retention is right is still an open product question.
      try {
        await this.clientObject.send(
          new CopyObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: `deleted_${sourceKey}`,
            CopySource: `${process.env.S3_BUCKET}/${sourceKey}`,
            // Deliberately left in STANDARD: at 3 days this copy is gone well
            // before Intelligent-Tiering could earn back its monitoring charge.
          }),
        );
      } catch (copyError) {
        // A single CopyObject stops at 5 GiB, and multipart uploads made books
        // past that possible. Without this, the failed copy would skip the
        // delete below and leave the book billed forever with no row pointing
        // at it. Such books go without the 3-day support copy instead.
        if (!(await this.exceedsSingleCopyLimit(sourceKey))) throw copyError;
        this._logger.log({
          origin: 'S3: deleteFile',
          message: 'Deleting without a support copy: object exceeds the 5 GiB copy limit',
          data: { sourceKey },
        });
      }
      await this.clientObject.send(
        new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: sourceKey,
        }),
      );
      return true;
    } catch (error) {
      this._logger.log({
        origin: 'S3: deleteFile',
        message: error.message,
        data: { sourceKey },
      });
      return null;
    }
  }
  /** Only a definite answer counts: a failed HEAD keeps the delete's old behaviour. */
  private async exceedsSingleCopyLimit(key: string): Promise<boolean> {
    try {
      const head = await this.client.headObject({
        Bucket: process.env.S3_BUCKET,
        Key: key,
      });
      return (head.ContentLength ?? 0) > MAX_SINGLE_COPY_SIZE;
    } catch {
      return false;
    }
  }

  async calculateFolderSize(folderKey: string): Promise<number> {
    try {
      let totalSize = 0;
      const command = new ListObjectsV2Command({
        Bucket: process.env.S3_BUCKET,
        Prefix: folderKey,
      });
      const response = await this.clientObject.send(command);
      const objects = response.Contents;
      objects?.forEach((object) => {
        totalSize += object.Size;
      });
      return totalSize;
    } catch (error) {
      console.error(error);
      this._logger.log({
        origin: 'S3: calculateFolderSize',
        message: error.message,
        data: { folderKey },
      });
      return null;
    }
  }
  async addLifecycleRule(
    ruleId: string,
    prefix: string,
    storageClass: string,
  ): Promise<boolean> {
    try {
      let existingRules: LifecycleRule[] = [];
      try {
        const getResponse = await this.clientObject.send(
          new GetBucketLifecycleConfigurationCommand({
            Bucket: process.env.S3_BUCKET,
          }),
        );
        existingRules = getResponse.Rules || [];
      } catch (error) {
        if (error.name !== 'NoSuchLifecycleConfiguration') {
          throw error;
        }
      }

      if (existingRules.some((r) => r.ID === ruleId)) {
        return true;
      }

      const newRule: LifecycleRule = {
        ID: ruleId,
        Filter: { Prefix: prefix },
        Status: 'Enabled',
        Transitions: [
          {
            Days: 0,
            StorageClass: storageClass as TransitionStorageClass,
          },
        ],
      };

      await this.clientObject.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: process.env.S3_BUCKET,
          LifecycleConfiguration: {
            Rules: [...existingRules, newRule],
          },
        }),
      );

      return true;
    } catch (error) {
      this._logger.log(
        {
          origin: 'S3: addLifecycleRule',
          message: error.message,
          data: { ruleId, prefix, storageClass },
        },
        'error',
      );
      return false;
    }
  }

  async getObjectStream(
    key: string,
    headers?: S3ClientHeaders,
  ): Promise<{
    statusCode: number;
    body: Readable;
    headers: { [k: string]: string | number };
  }> {
    try {
      const obj = {
        Bucket: process.env.S3_BUCKET,
        Key: key,
        ...(headers || {}),
      };
      if (obj.IfModifiedSince) {
        obj.IfModifiedSince = moment(obj.IfModifiedSince).toDate();
      }
      if (obj.IfUnmodifiedSince) {
        obj.IfUnmodifiedSince = moment(obj.IfUnmodifiedSince).toDate();
      }
      const command = new GetObjectCommand(
        obj as unknown as GetObjectCommandInput,
      );
      const response = await this.clientObject.send(command);
      const responseHeader: { [k: string]: string | number } = {};
      if (response.AcceptRanges) {
        responseHeader['Accept-Ranges'] = response.AcceptRanges;
      }
      if (response.ContentLength) {
        responseHeader['Content-Length'] = response.ContentLength;
      }
      if (response.ContentRange) {
        responseHeader['Content-Range'] = response.ContentRange;
      }
      if (response.ContentType) {
        responseHeader['Content-Type'] = response.ContentType;
      }
      if (response.ETag) {
        responseHeader['ETag'] = response.ETag;
      }
      if (response.LastModified) {
        responseHeader['Last-Modified'] = `${response.LastModified}`;
      }

      return {
        statusCode: response.$metadata.httpStatusCode,
        headers: responseHeader,
        body: response.Body as Readable,
      };
    } catch (error) {
      this._logger.log({
        origin: 'S3Service.getObjectStream',
        error,
        data: { key },
      });
      if (error?.$metadata) {
        return {
          statusCode: error?.$metadata.httpStatusCode,
          body: null,
          headers: null,
        };
      }
      return null;
    }
  }
}
