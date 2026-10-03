{{- define "platform.labels" -}}
app.kubernetes.io/part-of: trainme
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "platform.keycloakConfig" -}}
KC_DB: postgres
KC_DB_URL: "jdbc:postgresql://trainme-pg-rw:5432/keycloak_db"
KC_DB_USERNAME: keycloak
KC_HTTP_RELATIVE_PATH: /auth
KC_HOSTNAME: "{{ .Values.publicUrl }}/auth"
KC_HOSTNAME_BACKCHANNEL_DYNAMIC: "true"
KC_PROXY_HEADERS: xforwarded
KC_HEALTH_ENABLED: "true"
KC_BOOTSTRAP_ADMIN_USERNAME: admin
JAVA_OPTS_KC_HEAP: "-Xms256m -Xmx512m"
TRAINME_PUBLIC_URL: {{ .Values.publicUrl | quote }}
{{- end -}}
