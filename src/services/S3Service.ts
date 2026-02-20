import { inject, injectable } from 'inversify';
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
  TransitionStorageClass,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3ClientHeaders, StorageAction, StorageItem } from '../types/user';
import moment from 'moment';
import { ILoggerService } from '../interfaces/ILoggerService';
import { TYPES } from '../ContainerTypes';
import { Readable } from 'stream';

@injectable()
export class S3Service {
  @inject(TYPES.LoggerService)
  private _logger: ILoggerService;
  private client = new S3({ region: process.env.S3_REGION });
  private clientObject = new S3Client({ region: process.env.S3_REGION });

  async fileExists(key: string): Promise<boolean> {
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
        return false;
      } else {
        this._logger.log({
          origin: 'S3: fileExists',
          message: error.message,
          data: { key },
        });
        return null;
      }
    }
  }

  async GetDirectoryContent(
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
        origin: 'S3: GetDirectoryContent',
        message: err.message,
        data: { path },
      });
      return null;
    }
  }

  async GetPresignedUrl(
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
          command = new PutObjectCommand(obj);
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
        origin: 'S3: GetPresignedUrl',
        message: error.message,
        data: { key, type },
      });
      return null;
    }
  }

  async moveFile(sourceKey: string, targetKey: string): Promise<boolean> {
    try {
      await this.clientObject.send(
        new CopyObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: targetKey,
          CopySource: `${process.env.S3_BUCKET}/${encodeURIComponent(
            sourceKey,
          )}`,
        }),
      );
      await this.clientObject.send(
        new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: sourceKey,
        }),
      );
      return true;
    } catch (error) {
      this._logger.log({
        origin: 'S3: moveFile',
        message: error.message,
        data: { sourceKey, targetKey },
      });
      return null;
    }
  }

  async deleteFile(sourceKey: string): Promise<boolean> {
    try {
      /// Keep a copy for a week just in case for support purposes
      await this.clientObject.send(
        new CopyObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: `deleted_${sourceKey}`,
          CopySource: `${process.env.S3_BUCKET}/${sourceKey}`,
        }),
      );
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

  async GetObjectStream(
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
        origin: 'S3: GetObjectStream',
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
