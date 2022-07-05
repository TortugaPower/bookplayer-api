/* eslint-disable @typescript-eslint/no-explicit-any */
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import { injectable } from 'inversify';
import { RestClientProps } from '../types/user';

@injectable()
export class RestClientService {
  private axiosInstance = axios.create();

  async setupClient() {
    this.axiosInstance.interceptors.request.use(
      (config: AxiosRequestConfig) => {
        return config;
      },
    );
    this.axiosInstance.interceptors.response.use(
      (response: AxiosResponse) => {
        return response;
      },
      (error: AxiosError) => {
        const apiError = error.response?.data.message;
        if (apiError) {
          return Promise.reject(new Error(apiError));
        }
        return Promise.reject(error);
      },
    );
  }

  async callService({
    headers,
    body,
    baseURL,
    service,
    method,
  }: RestClientProps): Promise<any> {
    let reqHeader = {};
    if (headers) {
      reqHeader = Object.assign(reqHeader, headers);
    }
    const request: AxiosRequestConfig = {
      headers: reqHeader,
      method,
      url: service,
      baseURL,
      withCredentials: true,
    };
    if (method === 'post') {
      request.data = body;
    }
    return this.axiosInstance(request).then((response: any) => response.data);
  }
}
