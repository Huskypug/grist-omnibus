Grist Omnibus Fork
=============

fork of original [version](https://github.com/gristlabs/grist-omnibus)

## Key difference

Implemented solution for [automatically adding users to organization](https://community.getgrist.com/t/automatically-add-new-users-to-an-organization/2001).
Tested only with LDAP configuration, Google and Microsoft auth should work as well.

Core idea:
1. Modified golang script between grist and dex to catch email from auth provider
2. Using Grist Api check if the email is a part of the organization
3. If not then add new User via Api to organization with editor permissions

## Configuration description

Here's the minimal configuration you need to provide.
 * `EMAIL`: an email address, used for Let's Encrypt and for
   initial login.
 * `PASSWORD`: optional - if you set this, you'll be able to
   log in without configuring any other authentication
   settings. You can add more accounts as `EMAIL2`,
   `PASSWORD2`, `EMAIL3`, `PASSWORD3` etc.
 * `TEAM` - a short lowercase identifier, such as a company or project name
   (`grist-labs`, `cool-beans`). Just `a-z`, `0-9` and
   `-` characters please.
 * `URL` - this is important, you need to provide the base
   URL at which Grist will be accessed. It could be something
   like `https://grist.example.com`, or `http://localhost:9999`.
   No path element please.
 * `HTTPS` - mandatory if `URL` is `https` protocol. Can be
   `auto` (Let's Encrypt) if Grist is publically accessible and
   you're cool with automatically getting a certificate from
   Let's Encrypt. Otherwise use `external` if you are dealing
   with ssl termination yourself after all, or `manual` if you want
   to provide a certificate you've prepared yourself (there's an
   example below).
 * `GAPI_KEY` - api key for admin user for auto adding new users to organization.
    Should be added after the first startup and login for admin user. See instructions bellow


The minimal storage needed is an empty directory mounted
at `/persist`.

## Install
1. Clone repo & build image
```bash
git clone https://github.com/Huskypug/grist-omnibus.git
cd grist-omnibus
docker build -t grist-custom:latest .
cd ..
```
2. Create dex.yaml based on example from this repo and start for the first time
```bash
touch dex.yaml
mkdir persist
docker run \
  -p 9999:80 \
  -e URL=http://localhost:9999 \
  -e TEAM=cool-beans \
  -e EMAIL=owner@example.com \
  -e PASSWORD=topsecret \
  -v $PWD/persist:/persist \
  -v $PWD/dex.yaml:/custom/dex.yaml \
  --name grist --rm \
  -it grist-custom:latest
```
3. login as owner@example.com:topsecret via "Log in with Email"
4. Profile settings -> save API Key
5. Add api key to run command and run in detached mode
```bash
docker run -d \
  -p 9999:80 \
  -e URL=http://localhost:9999 \
  -e TEAM=cool-beans \
  -e EMAIL=owner@example.com \
  -e PASSWORD=topsecret \
  -e GRIST_ENABLE_SCIM=true \
  -e GAPI_KEY=<key here> \
  -v $PWD/persist:/persist \
  -v $PWD/dex.yaml:/custom/dex.yaml \
  --name grist --rm \
  -it grist-custom:latest
```

