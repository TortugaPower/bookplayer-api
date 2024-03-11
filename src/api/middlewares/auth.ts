import { IRequest, IResponse, INext } from '../../interfaces/IRequest';
import JWT from 'jsonwebtoken';
import cookie from 'cookie';
import { APP_CONST } from '../../utils/constant';

const loggedUser = (req: IResponse, _res: IRequest, next: INext) => {
  try {
    const cookies = cookie.parse(req.headers.cookie || '');
    const authorization =
      req.headers.authorization || cookies[APP_CONST.SESSION_COOKIE_NAME];
    if (authorization) {
      const token = authorization.replace('Bearer', '').trim();
      const decoded = JWT.verify(token, process.env.APP_SECRET);
      req.user = decoded;
    }
  } catch (err) {
    req.user = undefined;
  }
  return next();
};

export default loggedUser;
