import { injectable } from 'inversify';
import { S3 } from "@aws-sdk/client-s3";
import { StorageItem } from '../types/user';

@injectable()
export class StorageService {
  private client = new S3({ region: process.env.S3_REGION });

  async GetDirectoryContent(path: string): Promise<StorageItem[]> {
    try {
      const fixPath = path[path.length -1] === '/' ? path : path + '/';
      const objects = await this.client.listObjectsV2({
        Bucket: process.env.S3_BUCKET,
        Delimiter: '/',
        Prefix: fixPath,
      });
      const files = objects?.Contents || [];
      const folders = objects.CommonPrefixes?.map(pre => {
        return {
          Key: pre.Prefix,
          Size: 0,
          isFolder: true,
        }
      }) || [];
      const content = files.concat(folders);
      return content.filter(item => item.Key !== fixPath);
    } catch(err)  {
      console.log(err.message);
      return null;
    }
  }
}