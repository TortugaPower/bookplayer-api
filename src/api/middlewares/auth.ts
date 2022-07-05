import { IRequest, IResponse, INext } from '../../interfaces/IRequest';
import JWT from 'jsonwebtoken';

const loggedUser = (req: IResponse, _res: IRequest, next: INext) => {
  const authorization = req.headers?.authorization;
  if (authorization) {
    const token = authorization.replace('Bearer', '').trim();
    try {
      const decoded = JWT.verify(token, process.env.APP_SECRET);
      req.user = decoded;
    } catch (err) {
      req.user = undefined;
    }
  }
  return next();
};

export default loggedUser;
