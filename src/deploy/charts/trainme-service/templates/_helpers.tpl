{{/* Alias name inside the umbrella chart (e.g. records-svc); release name when installed standalone. */}}
{{- define "svc.name" -}}
{{- $base := ternary .Release.Name .Chart.Name (eq .Chart.Name "trainme-service") -}}
{{- default $base .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "svc.labels" -}}
app.kubernetes.io/name: {{ include "svc.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}-{{ include "svc.name" . }}
app.kubernetes.io/part-of: trainme
app.kubernetes.io/version: {{ .Values.image.tag | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "svc.selector" -}}
app.kubernetes.io/name: {{ include "svc.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}-{{ include "svc.name" . }}
{{- end -}}

{{- define "svc.image" -}}
{{ .Values.image.repository }}:{{ .Values.image.tag }}
{{- end -}}

{{/* Non-secret settings rendered into the <service>-config ConfigMap.
     Layers (later wins): env (common) → envPlatform (environment middleware) → envExtra (service-specific). */}}
{{- define "svc.config" -}}
{{- $env := merge (deepCopy (.Values.envExtra | default dict)) (.Values.envPlatform | default dict) (.Values.env | default dict) }}
{{- $_ := set $env "SERVICE_NAME" (include "svc.name" .) }}
{{- $_ := set $env "PORT" (toString .Values.containerPort) }}
{{- $_ := set $env "RUN_MIGRATIONS" "false" }}
{{- with .Values.global.publicUrl }}
{{- $_ := set $env "OIDC_ISSUER_URL" (printf "%s/auth/realms/trainme" .) }}
{{- $_ := set $env "PUBLIC_URL" . }}
{{- end }}
{{- range $k := keys $env | sortAlpha }}
{{ $k }}: {{ get $env $k | toString | quote }}
{{- end }}
{{- end -}}

{{/* Secret values only; everything else comes from ConfigMaps via envFrom. */}}
{{- define "svc.secretEnv" -}}
{{- range $k, $v := .Values.secretEnv }}
- name: {{ $k }}
  valueFrom:
    secretKeyRef: { name: {{ $v.secret }}, key: {{ $v.key }} }
{{- end }}
{{- end -}}

{{/* envFrom order matters: for duplicate keys the LAST source wins, so the optional
     operator-managed <service>-overrides ConfigMap overrides the chart defaults. */}}
{{- define "svc.envFrom" -}}
- configMapRef: { name: {{ include "svc.name" . }}-config }
- configMapRef: { name: {{ include "svc.name" . }}-overrides, optional: true }
{{- range .Values.envFromSecrets }}
- secretRef: { name: {{ . }} }
{{- end }}
{{- end -}}
