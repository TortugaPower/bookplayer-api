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

@injectable()
export class StorageService {
  private client = new S3({ region: process.env.S3_REGION });
  private clientObject = new S3Client({ region: process.env.S3_REGION });

  async GetDirectoryContent(path: string): Promise<StorageItem[]> {
    try {
      const fixPath = path[path.length - 1] === '/' ? path : path + '/';
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
      return content.filter((item) => item.Key !== fixPath);
    } catch (err) {
      console.log(err.message);
      return null;
    }
  }

  async GetPresignedUrl(key: string, type: S3Action): Promise<string> {
    try {
      let command;
      const obj = {
        Bucket: process.env.S3_BUCKET,
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
      const url = await getSignedUrl(this.clientObject, command, {
        expiresIn: 3600,
      });
      return url;
    } catch (error) {
      console.log(error.message);
      return null;
    }
  }

  async copyFile(
    sourceKey: string,
    targetKey: string,
    move: boolean,
  ): Promise<boolean> {
    try {
      console.log('sourceKey', `${process.env.S3_BUCKET}/${sourceKey}`);
      console.log('targetKey', targetKey);
      if (move) {
        await this.clientObject.send(
          new CopyObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: targetKey,
            CopySource: `${process.env.S3_BUCKET}/${sourceKey}`,
          }),
        );
      }
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