# 📖 Manual de Usuario: BlockUrna (Escrutinio Criptográfico Experimental)

Este manual documenta el paso a paso estructurado para desplegar, operar y auditar una elección digital completa utilizando la plataforma **BlockUrna**, actualizada hasta la **Fase 9C**. Esta fase incorpora pruebas **Zero-Knowledge con backend de alto desempeño en Rust**, **pruebas de inclusión Merkle de Poseidon**, verificación **on-chain** de la proof Groth16 y firmas de Actas **ECDSA SECP256K1 Reales** mapeadas por roles estancos (AEA y JED), asegurando transacciones y content hashes exactos on-chain y off-chain.

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

### 1.3 Inicio Rápido Centralizado (Recomendado)
Para evitar la apertura de múltiples terminales, hemos diseñado un script orquestador que inicia en background la base de datos, el nodo Blockchain (con sus despliegues) y todos los subsistemas a la vez usando Turborepo.

Ejecuta el script de desarrollo desde la raíz:
```bash
./start-dev.sh
```
> [!TIP]
> Todos los logs se centralizarán en tu consola actual de manera colorizada. Para apagar todo de manera limpia, solamente debes presionar `Ctrl+C`.

---

## 2. Iniciar Servicios del Ecosistema (Modo Manual Separado)

> [!NOTE]
> Sólo usa esto si no estás corriendo el `start-dev.sh` recomendado arriba, si necesitas debugear el proceso manual.

### 2.1 Arrancar la Blockchain y Desplegar el Registro
En una terminal aislada, prende el simulador blockchain:
```bash
pnpm -F @blockurna/contracts run node
```
Y desde otra terminal, realiza la compilación y despliegue del registro:
```bash
pnpm build
pnpm -F @blockurna/contracts deploy:localhost
```

### 2.2 Levantar los submódulos usando Turborepo
En otra pestaña:
```bash
pnpm dev
```
Esto levantará simultáneamente:
- Indexador de evidencia y API base en el Puerto `3020`
- Authority Console (Puerto `3013`)
- Tally Board (Puerto `3005`)
- Observer Portal (Puerto `3011`)
- Voter Portal (Puerto `3000`)

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

### D. Escrutinio Experimental ZK (JED)
1. Entra al **Tally Board** [http://localhost:3005](http://localhost:3005).
2. Ingresa al ID de tu elección finalizada.
3. Lanza el escrutinio. Con la Fase 9B actual, el sistema desencadena el **motor ZK impulsado por Rust (`zk_tally_rs`)**. 
4. El procesamiento computará la prueba ZK de recuento en tu máquina local (~8 a 15 segundos para 64 boletas simulando los Poseidon Merkle Verifiers) y publicará criptográficamente:
   - `ACTA_ESCRUTINIO` (Con la validación de inclusión Merkle)
   - `ACTA_RESULTADOS` 
5. Revisa los terminales: **Tally-board ha emparejado las firmas ECDSA y la Inclusión lógica (ZKP). Por su parte, la Evidence API corroboró que las raíces computadas sean honestas de acuerdo a la cadena.**

---

## 4. Portal de Auditoría Pública y CLI

Una vez el ciclo ha finalizado, BlockUrna emite actas criptográficamente selladas bajo la política (AEA / JED). Entra al **Observer Portal** [http://localhost:3011](http://localhost:3011).
    - En el visor de **Actas (Referencias Ancladas)** certificarás que las validaciones figuran `VALID`.
    - Podrás verificar de forma pública los **Poseidon Roots** y la confirmación de la prueba criptográfica de "Inclusión de Merkle ZK" que avala que los votos contabilizados estaban originalmente en la bóveda inalterada.
    - Disecciona libremente la transformación formal: *contentHash -> signingDigest -> anchoredHash*.

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
