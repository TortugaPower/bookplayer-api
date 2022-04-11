import path from 'path';
import envSchema from 'env-schema';
import S from 'fluent-json-schema';

export const Envs = () => {
  const result = require('dotenv').config({
    path: path.join(__dirname, `../../${process.env.NODE_ENV ?? 'development'}.env`),
  });

  if (result.error) {
    throw new Error(result.error);
  }
  const scheme = {
    data: result.parsed,
    schema: S.object()
      .prop('NODE_ENV', S.string().enum(['development', 'testing', 'production']).required())
      .prop('API_PORT', S.string().required())
      .prop('DB_HOST', S.string().required())
      .prop('DB_USER', S.string().required())
      .prop('DB_PASSWORD', S.string().required())
      .prop('DB_DATABASE', S.string().required())
      .prop('S3_BUCKET', S.string().required())
      .prop('AWS_ACCESS_KEY_ID', S.string().required())
      .prop('AWS_SECRET_ACCESS_KEY', S.string().required())
      .prop('S3_REGION', S.string().required())
      .prop('APPLE_CLIENT_ID', S.string().required())
      .prop('APP_SECRET', S.string().required()),
  };
  envSchema(scheme);
}

export default Envs;