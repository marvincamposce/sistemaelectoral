# Guía rápida de demo (5–7 min)

## Preparación (antes de la clase)

1. Abre 3 terminales.
2. Asegúrate de tener MetaMask instalado.
3. Agrega la red local:
   - RPC: `http://127.0.0.1:8545`
   - chainId: `31337`

## Paso a paso

### A) Blockchain local + deploy

Terminal 1:

```bash
cd BlockUrna/contracts
npm run node
```

Terminal 2:

```bash
cd BlockUrna/contracts
npm run deploy:localhost
```

### B) Levantar dApp + landing

Terminal 3:

```bash
cd BlockUrna/web
npm run dev -- -p 3001
```

(Opcional) otra terminal:

```bash
cd landing
npm run dev
```

### C) Demo del flujo

1. En MetaMask, **importa** 2 cuentas del nodo (private keys que se imprimen).
2. En la dApp, conecta wallet con la cuenta #0 (admin):
   - Presiona **Abrir registro**.
3. Cambia a cuenta #1 (votante):
   - Presiona **Solicitar registro**.
4. Vuelve a cuenta #0 (admin):
   - En “Solicitudes pendientes” → **Aprobar**.
5. Admin (#0):
   - Presiona **Abrir votación**.
6. Votante (#1):
   - Presiona **Votar** en un partido.
7. Muestra el conteo actualizado:
   - En la misma lista de partidos verás el incremento.

## Tip para auditoría

- Puedes mostrar el hash de transacción en la sección de estado de la dApp.
- (Opcional) En clase puedes abrir la consola del nodo para enseñar que el voto es un `tx` real.
