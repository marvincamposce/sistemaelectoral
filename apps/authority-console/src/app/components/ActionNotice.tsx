type TipoAviso = "ok" | "aviso" | "error";

const MENSAJES_AVISO: Record<string, string> = {
  "eleccion-creada": "La eleccion fue creada y quedo lista para seguir configurando su operacion.",
  "expediente-guardado": "El expediente ciudadano fue guardado correctamente.",
  "lote-importado": "El lote de expedientes fue importado correctamente.",
  "billetera-vinculada": "La billetera quedo vinculada al expediente consultado.",
  "solicitud-revisada": "La solicitud de enrolamiento fue revisada y su estado ya quedo actualizado.",
  "expediente-desde-solicitud": "El expediente fue creado o actualizado a partir de la solicitud seleccionada.",
  "ciudadano-autorizado": "La autorizacion electoral fue registrada y el ciudadano ya puede continuar en su flujo.",
  "fase-actualizada": "La fase de la eleccion fue actualizada correctamente.",
  "acta-publicada": "El acta quedo publicada y anclada para su trazabilidad.",
  "incidente-registrado": "El incidente operativo fue registrado en la bitacora administrativa.",
  "candidatura-guardada": "La candidatura fue guardada y el manifiesto quedo sincronizado.",
  "candidatura-estado-actualizado": "El estado de la candidatura fue actualizado y el manifiesto se regenero.",
  "catalogo-bloqueado": "El catalogo no puede modificarse en la fase actual. La consola mantuvo la eleccion sin cambios.",
  "fase-rechazada": "La red rechazo el cambio de fase. Verifica el estado real de la eleccion y espera a que la evidencia termine de sincronizarse antes de reintentar.",
  "acta-rechazada": "No se pudo publicar el acta. Revisa que el tipo elegido sea coherente con la fase actual y que la red siga disponible.",
};

function textoAviso(codigo: string | null | undefined): string | null {
  if (!codigo) return null;
  return MENSAJES_AVISO[codigo] ?? null;
}

export function construirRutaConAviso(
  rutaBase: string,
  codigo: string,
  tipo: TipoAviso = "ok",
  extras?: Record<string, string | number | null | undefined>,
): string {
  const params = new URLSearchParams();
  params.set("aviso", codigo);
  params.set("tipo", tipo);
  for (const [clave, valor] of Object.entries(extras ?? {})) {
    if (valor === null || valor === undefined || String(valor).length === 0) continue;
    params.set(clave, String(valor));
  }
  return `${rutaBase}?${params.toString()}`;
}

export function ActionNotice(props: {
  codigo?: string | null;
  tipo?: string | null;
}) {
  const texto = textoAviso(props.codigo);
  if (!texto) return null;

  const tipo = String(props.tipo ?? "").toLowerCase();
  const esAviso = tipo === "aviso";
  const esError = tipo === "error";

  return (
    <div
      className={`rounded-2xl border px-4 py-3 text-sm ${
        esError
          ? "border-rose-200 bg-rose-50 text-rose-900"
          : esAviso
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-emerald-200 bg-emerald-50 text-emerald-900"
      }`}
    >
      <div className="font-semibold">{esError ? "Operacion rechazada" : esAviso ? "Aviso operativo" : "Operacion completada"}</div>
      <div className="mt-1">{texto}</div>
    </div>
  );
}
