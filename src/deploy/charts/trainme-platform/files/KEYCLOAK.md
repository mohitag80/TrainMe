# Keycloak realm `trainme` (test environments only)

`realm-trainme.json` is imported when Keycloak starts (`--import-realm`). `${…}` placeholders are filled from
the container environment (`TRAINME_PUBLIC_URL`, `SERVICES_CLIENT_SECRET`, `TEST_USER_PASSWORD`).

| User                 | Roles                  | Plan  |
| -------------------- | ---------------------- | ----- |
| asha@trainme.test    | member                 | PRO   |
| ravi@trainme.test    | member                 | FREE  |
| meera@trainme.test   | member                 | ELITE |
| coach@trainme.test   | member, curator        | PRO   |
| support@trainme.test | member, support        | FREE  |
| admin@trainme.test   | member, admin, curator | ELITE |

Password for all: `TEST_USER_PASSWORD` (default `Passw0rd!`).

| Client           | Type                             | Use                                                       |
| ---------------- | -------------------------------- | --------------------------------------------------------- |
| trainme-web      | public, PKCE                     | web app login                                             |
| trainme-mobile   | public, PKCE                     | mobile app (`trainme://auth/callback`)                    |
| trainme-cli      | public, password grant           | **test only**: scripts and smoke tests                    |
| trainme-services | confidential, client credentials | service-to-service calls; may update the `plan` attribute |

Access tokens carry `aud: trainme-api`, `realm_access.roles` and a `plan` claim (user attribute, written by subscription-svc).
Get a token for scripting:

```bash
curl -s -d grant_type=password -d client_id=trainme-cli -d username=asha@trainme.test -d 'password=Passw0rd!' \
  http://localhost:8000/auth/realms/trainme/protocol/openid-connect/token | jq -r .access_token
```
