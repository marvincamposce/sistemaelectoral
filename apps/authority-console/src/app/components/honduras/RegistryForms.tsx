export function RegistryForms({
  upsertCensusRecordAction,
  bulkImportCensusAction,
  upsertWalletLinkAction,
}: {
  upsertCensusRecordAction: (formData: FormData) => Promise<void>;
  bulkImportCensusAction: (formData: FormData) => Promise<void>;
  upsertWalletLinkAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <div className="space-y-8">
      <div className="admin-card">
        <div className="admin-card-header">
          <div>
            <h2 className="admin-section-title m-0">Registrar o actualizar expediente</h2>
            <p className="text-xs text-slate-500 mt-1">Crea o corrige datos de censo para habilitar autorizaciones y autenticación ciudadana.</p>
          </div>
        </div>
        <div className="admin-card-body">
          <form action={upsertCensusRecordAction} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="admin-label">DNI</label>
                <input className="admin-input" name="dni" required placeholder="0801199912345" />
              </div>
              <div className="space-y-1">
                <label className="admin-label">Estado</label>
                <select className="admin-input" name="habilitationStatus" defaultValue="HABILITADO">
                  <option value="HABILITADO">HABILITADO</option>
                  <option value="INHABILITADO">INHABILITADO</option>
                  <option value="SUSPENDIDO">SUSPENDIDO</option>
                  <option value="FALLECIDO">FALLECIDO</option>
                </select>
              </div>
            </div>
            
            <div className="space-y-1">
              <label className="admin-label">Nombre completo</label>
              <input className="admin-input" name="fullName" required placeholder="Nombres y Apellidos" />
            </div>
            
            <div className="space-y-1">
              <label className="admin-label">Motivo o nota de estado</label>
              <input className="admin-input" name="statusReason" placeholder="Ej: Actualización manual" />
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="admin-label">Fuente</label>
                <input className="admin-input" name="source" defaultValue="MANUAL_AEA" />
              </div>
              <div className="space-y-1">
                <label className="admin-label">Código ciudadano</label>
                <input className="admin-input" name="citizenAccessCode" placeholder="Mínimo 6 caracteres" minLength={6} />
              </div>
            </div>

            <div className="space-y-1">
              <label className="admin-label">Metadata JSON (opcional)</label>
              <input className="admin-input font-mono" name="metadataJson" placeholder='{"batch":"abril"}' />
            </div>

            <button className="admin-btn-primary w-full sm:w-auto" type="submit">
              Guardar expediente
            </button>
          </form>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        <div className="admin-card">
          <div className="admin-card-header">
            <div>
              <h2 className="admin-section-title m-0">Importación masiva</h2>
              <p className="text-xs text-slate-500 mt-1">Carga lotes de expedientes desde JSON validado.</p>
            </div>
          </div>
          <div className="admin-card-body">
            <form action={bulkImportCensusAction} className="space-y-4">
              <textarea
                className="admin-input font-mono text-xs"
                name="recordsJson"
                rows={8}
                required
                placeholder={'[\n  {\n    "dni": "0801199912345",\n    "fullName": "Ciudadana Ejemplo",\n    "habilitationStatus": "HABILITADO",\n    "source": "CENSO_HN_2026"\n  }\n]'}
              />
              <button className="admin-btn-outline w-full text-indigo-600 border-indigo-200 hover:bg-indigo-50" type="submit">
                Importar lote
              </button>
            </form>
          </div>
        </div>

        <div className="admin-card">
          <div className="admin-card-header">
            <div>
              <h2 className="admin-section-title m-0">Vincular billetera</h2>
              <p className="text-xs text-slate-500 mt-1">Asigna manualmente una dirección a un DNI existente.</p>
            </div>
          </div>
          <div className="admin-card-body">
            <form action={upsertWalletLinkAction} className="space-y-4">
              <input className="admin-input" name="dni" required placeholder="DNI ya cargado" />
              <input className="admin-input font-mono" name="walletAddress" required placeholder="0x..." />
              
              <div className="grid grid-cols-2 gap-4">
                <select className="admin-input" name="linkStatus" defaultValue="ACTIVE">
                  <option value="ACTIVE">Activa</option>
                  <option value="REVOKED">Revocada</option>
                </select>
                <select className="admin-input" name="verificationMethod" defaultValue="MANUAL_AEA">
                  <option value="MANUAL_AEA">MANUAL_AEA</option>
                  <option value="SELF_ATTESTED">SELF_ATTESTED</option>
                  <option value="CENSUS_VERIFIED">CENSUS_VERIFIED</option>
                  <option value="SYSTEM_MANAGED">SYSTEM_MANAGED</option>
                </select>
              </div>

              <textarea
                className="admin-input font-mono text-xs"
                name="evidenceJson"
                rows={3}
                placeholder='Evidence JSON opcional, p.ej. {"operator":"aea-admin"}'
              />

              <button className="admin-btn-outline w-full text-emerald-600 border-emerald-200 hover:bg-emerald-50" type="submit">
                Guardar vínculo
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
