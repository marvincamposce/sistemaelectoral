export function HondurasWorkflow() {
  const steps = [
    ["1", "Consultar o crear expediente", "Carga el DNI, nombre y estado de habilitación."],
    ["2", "Configurar acceso", "Define o rota el código ciudadano y revisa observaciones."],
    ["3", "Autorizar por elección", "Provisiona una billetera gestionada y crea la autorización activa."],
    ["4", "Validar en portal", "El ciudadano ya puede entrar al flujo de voto con su código."],
  ];

  return (
    <div className="admin-card">
      <div className="admin-card-header">
        <h2 className="admin-section-title m-0">Flujo operativo recomendado</h2>
      </div>
      <div className="admin-card-body">
        <div className="grid gap-4 md:grid-cols-4">
          {steps.map(([index, title, description]) => (
            <article key={index} className="rounded-xl border border-slate-200 bg-slate-50 p-4 relative overflow-hidden group hover:border-cyan-300 transition-colors">
              <div className="absolute top-0 left-0 w-1 h-full bg-cyan-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-cyan-600 mb-2">Paso {index}</div>
              <div className="text-sm font-semibold text-slate-900 mb-2">{title}</div>
              <p className="text-xs text-slate-600 leading-relaxed">{description}</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
