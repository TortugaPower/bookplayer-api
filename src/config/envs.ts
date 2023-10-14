import path from 'path';
import envSchema from 'env-schema';
import S from 'fluent-json-schema';

export const Envs = () => {
  const result = require('dotenv').config({
    path: path.join(
      __dirname,
      `../../${
        process.env.NODE_ENV ? `.${process.env.NODE_ENV}` : '.development'
      }.env`,
    ),
  });

  if (result.error) {
    throw new Error(result.error);
  }
  const scheme = {
    data: result.parsed,
    schema: S.object()
      .prop(
        'NODE_ENV',
        S.string().enum(['development', 'testing', 'production']).required(),
      )
      .prop('API_PORT', S.string().required())
      .prop('DB_HOST', S.string().required())
      .prop('DB_USER', S.string().required())
      .prop('DB_PASSWORD', S.string().required())
      .prop('DB_DATABASE', S.string().required())
      .prop('S3_BUCKET', S.string().required())
      .prop('S3_REGION', S.string().required())
      .prop('APPLE_CLIENT_ID', S.string().required())
      .prop('APP_SECRET', S.string().required())
      .prop('REVENUECAT_HEADER', S.string().required())
      .prop('REVENUECAT_API', S.string().required())
      .prop('REVENUECAT_KEY', S.string().required())
      .prop('PROXY_FILE_URL', S.string().required())
      .prop('APP_VERSION', S.string().required()),
  };
  envSchema(scheme);
};

export default Envs;
