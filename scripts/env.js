const AWS = require('aws-sdk');
const fs = require('fs');

const setupEnv = async () => {
  try {
    const configsVarsRaw = fs.readFileSync('scripts/config.json');
    const configsVars = JSON.parse(configsVarsRaw);
    const AppConfigClient = new AWS.AppConfigData({ region: 'us-east-1' });
    const token = await new Promise((resolve, reject) => {
      AppConfigClient.startConfigurationSession(
        {
          ApplicationIdentifier: configsVars.ApplicationIdentifier,
          ConfigurationProfileIdentifier:
            configsVars.ConfigurationProfileIdentifier,
          EnvironmentIdentifier: configsVars.EnvironmentIdentifier,
        },
        (err, data) => {
          if (err) reject(err);
          resolve(data);
        },
      );
    });
    const { Configuration } = await new Promise((resolve, reject) => {
      AppConfigClient.getLatestConfiguration(
        {
          ConfigurationToken: token.InitialConfigurationToken,
        },
        (err, data) => {
          if (err) reject(err);
          resolve(data);
        },
      );
    });
    const configs = JSON.parse(Configuration.toString('utf8'));
    let stringEnv = '';
    Object.keys(configs).map((k) => {
      stringEnv += `${k}=${configs[k]}\n`;
    });
    fs.writeFileSync(`.env`, stringEnv);
  } catch (err) {
    console.log(err.message);
  }
};

setupEnv();
