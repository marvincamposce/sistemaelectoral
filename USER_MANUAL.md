# 📖 Manual de Usuario: BlockUrna (Escrutinio Criptográfico Experimental)

Este manual documenta el paso a paso estructurado para desplegar, operar y auditar una elección digital completa utilizando la plataforma **BlockUrna**, actualizada hasta la **Fase 8.1**. Esta fase se caracteriza por incluir firmas de Actas **ECDSA SECP256K1 Reales** mapeadas por roles estancos (AEA y JED) asegurando transacciones y content hashes exactos on-chain y off-chain.

---

## 1. Requisitos Previos e Inicialización

El ecosistema corre como un monorepo administrado por **pnpm** y utiliza servicios de PostgreSQL y un nodo emulado local de Blockchain (Hardhat).

### 1.1 Configurar Variables de Entorno (Automático)
Hemos diseñado un script configurador en la raíz que poblará automáticamente las llaves maestras para la ejecución local (Hardhat Account #0 y #1) simulando al organismo central AEA y las Juntas JED.

Ejecútalo desde la carpeta raíz:
```bash
./setup-env.sh
```
> [!NOTE] 
> Esto creará archivos `.env` y `.env.local` en las subcarpetas del sistema con las llaves de desarrollo idénticas, y fijará la dirección de contrato esperada al primer despliegue limpio `0x5FbDB...`.

### 1.2 Encender la Base de Datos (Postgres)
Se requiere que haya una base conectable. Usa el `docker-compose` de la raíz si lo tienes, o un postgres ordinario bajo `postgresql://blockurna:blockurna@127.0.0.1:5432/blockurna`.
```bash
docker-compose up -d postgres
```

### 1.3 Arrancar la Blockchain y Desplegar el Registro
En una terminal aislada, prende el simulador blockchain:
```bash
pnpm -F @blockurna/contracts run node
```
A partir de ahí (en otra terminal), compilar y desplegar los contratos.
```bash
pnpm build
pnpm -F @blockurna/contracts deploy:localhost
```
> [!IMPORTANT]
> Debes re-desplegar si apagas el nodo de hardhat, para que la dirección `0x5FbDB23...` coincida permanentemente con los env.

---

## 2. Iniciar Servicios del Ecosistema

Es necesario poner en marcha al unísono las piezas del sistema. Cada uno necesita preferiblemente su propia pestaña de terminal, aunque puedes agruparlos si lo deseas.

### Indexador y API Base (Motor de Evidencia)
Levanta la ingesta on-chain y la API local en `http://localhost:3020`
```bash
pnpm -F @blockurna/evidence-indexer dev
pnpm -F @blockurna/evidence-api dev
```

### Interfaces de Operación y Observación
Existen 4 vistas principales para distintos actores del ciclo:
```bash
pnpm -F @blockurna/authority-console dev   # Puerto 3013
pnpm -F @blockurna/tally-board dev         # Puerto 3005
pnpm -F @blockurna/observer-portal dev     # Puerto 3011
pnpm -F @blockurna/voter-portal dev        # Puerto 3000
```
> [!TIP]
> Si deseas iniciar todo velozmente, puedes crear scripts `turborepo` que apunten a los comandos `dev` de NextJS si cuentas con recursos, o abrirlos individualmente para leer sus Logs nativos.

---

## 3. Ciclo Electoral (Paso a Paso)

### A. Creación de la Elección (AEA)
1. Abre **Authority Console** en [http://localhost:3013](http://localhost:3013).
2. Haz clic en "Nueva Elección" y emite un Manifiesto y una Fase `SETUP`. Fírmalos para publicar.
3. Avanza la elección a **`REGISTRY_OPEN`**.
4. Inscribe credenciales/votantes dummy en su módulo respectivo o simulando la carga.
5. Cierra el registro avanzando a **`REGISTRY_CLOSED`**.
6. Abre la votación avanzando a **`VOTING_OPEN`** mediante el acta estructurada.

### B. Emisión de Votos (Ciudadanos)
1. Ingresa interactuando mediante **Voter Portal** [http://localhost:3000](http://localhost:3000).
2. Deberías poder ver la elección. Genera "votos de prueba" que representen tus sufragios crípticos (ciphertexts) a la bóveda conectada en red.

### C. Cierre (AEA)
De vuelta en **Authority Console**, publica el `ACTA_CIERRE` avanzando a fase **`VOTING_CLOSED`**.

### D. Escrutinio Experimental (JED)
1. Entra al **Tally Board** [http://localhost:3005](http://localhost:3005).
2. Ingresa al ID de tu elección finalizada.
3. Lanza el escrutinio (Tally Simulation Mode). Actualmente el procesamiento de boletas y el descifrado es un mock ZK (Zero-Knowledge Pending); **sin embargo**, podrás apreciar que al finalizar genera:
   - `ACTA_ESCRUTINIO`
   - `ACTA_RESULTADOS`
4. Revisa los terminales: **Tally-board ha cifrado con verdaderas firmas ECDSA y el Evidence API ha corroborado las mismas integridades del rol esperado**.

---

## 4. Portal de Auditoría Pública y CLI

Una vez el ciclo ha finalizado, BlockUrna emite actas criptográficamente selladas bajo la política (AEA / JED). Entra al **Observer Portal** [http://localhost:3011](http://localhost:3011).
    - En el visor de **Actas (Referencias Ancladas)** certificarás que las validaciones figuran `VALID`.
    - Podrás diseccionar la transformación formal: *contentHash -> signingDigest -> anchoredHash*.

### Verificación mediante Terminal (Audit CLI)
Si eres auditor institucional, se espera que no confíes en el Observer Portal a ciegas. Puedes rearmar las comprobaciones sin usar un navegador.

**Verificar Consistencia Total (Sincronizado a Fase 8.1):**
```bash
# Exportar Bundle Crudo
pnpm -F @blockurna/audit-cli run start export-audit-bundle --api http://127.0.0.1:3020 --election <ELECTION_ID> --out paquete.json

# Validarlo Criptográficamente Off-Chain/On-Chain mixto con sus Roles
pnpm -F @blockurna/audit-cli run start verify-audit-bundle --api http://127.0.0.1:3020 --election <ELECTION_ID>
```
La salida por consola te demostrará que cada firma (recoverSignerAddress) es válida, y que el ExpectedSigner coincida milimétricamente con el rol JED o AEA documentado. Si detecta desalineación, avisará `SIGNER_ROLE_MISMATCH`.
