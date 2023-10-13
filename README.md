> [!NOTE]
> We're still in the process of migrating the repository from an individual account on Bitbucket to the org account here on Github

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
* NodeJS (v16)
  * Yarn
* PostgresSQL
* Redis

After cloning the repository:
* Duplicate `development.env.template` into `.development.env`
  * Fill the environment variables with your DB info and S3 info
* Run `yarn` on the repository path to install the dependencies
* Make sure the local redis server is up and the DB is accessible, and run `yarn run dev` to start the server

## Additional resources

* Postman collection

  [![Run in Postman](https://run.pstmn.io/button.svg)](https://app.getpostman.com/run-collection/10416776-40a49b6e-8f9f-463f-8f06-7dc866a5815f?action=collection%2Ffork&source=rip_markdown&collection-url=entityId%3D10416776-40a49b6e-8f9f-463f-8f06-7dc866a5815f%26entityType%3Dcollection%26workspaceId%3D0b373f38-83d7-4257-9410-1baa18d69056)

* Whimsical sequence diagrams ([link](https://whimsical.com/sequence-diagram-placeholder-SeqQDp9C6h2wdWvyR315Hy))
