import { IRequest, IResponse, INext } from '../../interfaces/IRequest';
import JWT from 'jsonwebtoken';
import cookie from 'cookie';

const loggedUser = (req: IResponse, _res: IRequest, next: INext) => {
  const cookies = cookie.parse(req.headers.cookie || '');
  const cookieToken = cookies ? cookies[process.env.SESSION_COOKIE_NAME] : null;

  const authorization = req.headers?.authorization || cookieToken;
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
