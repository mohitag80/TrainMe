# Ansible – test VM

Prepares the RHEL 9 test VM (Docker + Compose, k3s without Traefik, Helm, firewall).

```bash
cp inventory/test.ini.example inventory/test.ini
ansible-galaxy collection install ansible.posix
ansible-playbook rhel-test-vm.yml
```

Then deploy either stack on the VM:

| Stack          | Command                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Docker Compose | `cp src/deploy/compose/.env.example src/deploy/compose/.env` → `pnpm stack:up` (or `docker compose ... up -d --build`) |
| k3s            | `src/deploy/k3s/build-images.sh` → `PUBLIC_URL=http://<vm> src/deploy/k3s/install.sh`                                  |

The VM has ~8 GB RAM: run one stack at a time.
