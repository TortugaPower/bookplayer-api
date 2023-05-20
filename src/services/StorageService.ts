import { injectable } from 'inversify';
import {
  S3,
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3Action, StorageItem } from '../types/user';
import moment from 'moment';

@injectable()
export class StorageService {
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
        console.log(error.message);
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
      console.log(err.message);
      return null;
    }
  }

  async GetPresignedUrl(
    key: string,
    type: S3Action,
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
        case S3Action.GET:
          command = new GetObjectCommand(obj);
          break;
        case S3Action.PUT:
          command = new PutObjectCommand(obj);
          break;
      }
      const seconds = 3600 * 24 * 7; // 1 hour * 24 * 7 = 7 days
      const expires = moment().add(seconds, 'seconds').unix();
      const url = await getSignedUrl(this.clientObject, command, {
        expiresIn: seconds,
      });
      return { url, expires_in: expires };
    } catch (error) {
      console.log(error.message);
      return null;
    }
  }

  async moveFile(sourceKey: string, targetKey: string): Promise<boolean> {
    try {
      console.log('sourceKey', `${process.env.S3_BUCKET}/${sourceKey}`);
      console.log('targetKey', targetKey);
      await this.clientObject.send(
        new CopyObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: targetKey,
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
      console.log(error.message);
      return null;
    }
  }

  async deleteFile(sourceKey: string): Promise<boolean> {
    try {
      console.log('sourceKey', `${process.env.S3_BUCKET}/deleted_${sourceKey}`);
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
      console.log(error.message);
      return null;
    }
  }
}
