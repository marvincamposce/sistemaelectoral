# Tally Board

Consola operativa para ejecutar el escrutinio real de BU-PVP-1:
- descarga ciphertexts publicados,
- descifra y cuenta votos,
- publica commitment de transcript,
- publica actas y abre auditoría.

Además soporta custodia 2-de-3 para la clave de descifrado, con carga manual o remota de shares firmadas.

## Ejecutar local

```bash
pnpm --filter @blockurna/tally-board dev
```

La app queda en `http://localhost:3005`.

## Variables de entorno relevantes

- `RPC_URL`
- `ELECTION_REGISTRY_ADDRESS`
- `AE_PRIVATE_KEY`
- `JED_PRIVATE_KEY`
- `COORDINATOR_PRIVATE_KEY`
- `DATABASE_URL`

Seguridad de endpoints remotos para trustees:
- `ENFORCE_REMOTE_TRUSTEE_API_KEY=true|false`
- `REMOTE_TRUSTEE_API_KEY=<secreto-compartido>`

Si `ENFORCE_REMOTE_TRUSTEE_API_KEY=true`, las rutas remotas requieren header `x-blockurna-api-key` (o `x-api-key`).

## Endpoints remotos de ceremonia/shares

Todos son `POST` y devuelven JSON.

1. Obtener mensaje canónico para firmar share:
- `POST /api/decryption-shares/signing-message`
- body:
```json
{
	"electionId": "1",
	"ceremonyId": "<uuid>",
	"trusteeId": "TRUSTEE_1",
	"sharePayload": "BU-PVP-1_THRESHOLD_2_OF_3_V1:1:0x..."
}
```

2. Enviar share firmada (API_SIGNED):
- `POST /api/decryption-shares`
- body:
```json
{
	"electionId": "1",
	"ceremonyId": "<uuid>",
	"trusteeId": "TRUSTEE_1",
	"sharePayload": "BU-PVP-1_THRESHOLD_2_OF_3_V1:1:0x...",
	"signerAddress": "0x...",
	"signature": "0x..."
}
```

3. Consultar estado de ceremonia:
- `POST /api/decryption-ceremony/state`

4. Abrir ceremonia:
- `POST /api/decryption-ceremony/open`

5. Cerrar ceremonia:
- `POST /api/decryption-ceremony/close`

## Notas operativas

- API_SIGNED verifica ECDSA sobre mensaje canónico de share (dominio `BU-PVP-1_DECRYPTION_SHARE_SUBMISSION_V1`).
- Ceremonias cerradas no aceptan nuevas shares.
- El tally requiere clave reconstruida por threshold 2-de-3; sin shares válidas suficientes, el escrutinio queda bloqueado.
