## About
This is the backend used to power the cross-device sync feature of [BookPlayer](https://github.com/TortugaPower/BookPlayer)

## Hosting

We're currently using AWS to host our servers:
* EC2 + ELB - for the node instances and load balancing between the nodes
* RDS - PostgreSQL instance
* S3 - for all the files storage
* Elasticache - Redis for websockets (although we stopped using them in the app around v5.0.3)

## Local setup

Requirements:
* NodeJS (v14)
  * Yarn
* PostgresSQL
* Redis

After cloning the repository:
* Duplicate `development.env.template` into `.development.env`
  * Fill the environment variables with your DB info and S3 info
* Run `yarn` on the repository path to install the dependencies
* Make sure the local redis server is up and the DB is accessible, and run `yarn run dev` to start the server
