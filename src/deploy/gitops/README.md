# GitOps (Argo CD)

`install.sh` deploys the test environment directly with Helm. When Argo CD is installed, the same charts
are reconciled from Git instead (docs/04 §2.3, sync waves):

```bash
helm upgrade --install argocd argo/argo-cd -n gitops --create-namespace
kubectl apply -f src/deploy/gitops/test/root-app.yaml      # app of apps for env=test
```

Image tags are set in `test/trainme.yaml` (`helm.parameters`); CI updates them per commit.
Secrets are not in Git: create them as in `src/deploy/k3s/install.sh` (or via Sealed Secrets).
