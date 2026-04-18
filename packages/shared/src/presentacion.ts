export function etiquetaEstado(estado: string | null | undefined, vacio = "Sin estado"): string {
  const valor = String(estado ?? "").toUpperCase();
  const etiquetas: Record<string, string> = {
    HABILITADO: "Habilitado",
    INHABILITADO: "Inhabilitado",
    SUSPENDIDO: "Suspendido",
    OBSERVADO: "Observado",
    FALLECIDO: "Fallecido",
    ACTIVE: "Activa",
    AUTHORIZED: "Autorizada",
    REVOKED: "Revocada",
    REJECTED: "Rechazada",
    APPROVED: "Aprobada",
    PENDING_REVIEW: "Pendiente de revision",
    OPEN: "Abierta",
    CLOSED: "Cerrada",
    VALID: "Valida",
    VERIFIED: "Verificada",
    VERIFIED_OFFCHAIN: "Verificada fuera de cadena",
    VERIFIED_ONCHAIN: "Verificada en cadena",
    BUILDING: "Generando",
    FAILED: "Fallida",
    TRANSCRIPT_COMMITTED: "Transcript comprometido",
    BLOCKED_BY_ZK: "Bloqueada por ZK",
    UNVERIFIED: "No verificada",
    RESULTS_PUBLISHED: "Resultados publicados",
    AUDIT_WINDOW: "Ventana de auditoria",
    AUDIT_WINDOW_OPEN: "Ventana de auditoria",
    ARCHIVED: "Archivada",
  };

  return etiquetas[valor] ?? (estado && estado.length > 0 ? estado : vacio);
}

export function etiquetaCanalSolicitud(canal: string | null | undefined, vacio = "No indicado"): string {
  const valor = String(canal ?? "").toUpperCase();
  const etiquetas: Record<string, string> = {
    PUBLIC_PORTAL: "Portal ciudadano",
    CITIZEN_AUTHENTICATED: "Expediente autenticado",
    AUTHORITY_CONSOLE: "Consola de autoridad",
    MANUAL_AEA: "Carga manual AEA",
  };

  return etiquetas[valor] ?? (canal && canal.length > 0 ? canal : vacio);
}

export function etiquetaMetodoBilletera(metodo: string | null | undefined, vacio = "No indicado"): string {
  const valor = String(metodo ?? "").toUpperCase();
  const etiquetas: Record<string, string> = {
    SYSTEM_MANAGED: "Gestionada por el sistema",
    MANUAL_AEA: "Validada por autoridad",
    CENSUS_VERIFIED: "Verificada contra censo",
    SELF_ATTESTED: "Declarada por ciudadania",
  };

  return etiquetas[valor] ?? (metodo && metodo.length > 0 ? metodo : vacio);
}
