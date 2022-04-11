// generic text functions
import crypto from 'crypto';
export const hashString = (text: string) => {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(8).toString('hex');
    crypto.scrypt(text, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
};

export const verifyHash = (text: string, hash: string) => {
  return new Promise((resolve, reject) => {
    const [salt, key] = hash.split(':');
    crypto.scrypt(text, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      resolve(key === derivedKey.toString('hex'));
    });
  });
};
