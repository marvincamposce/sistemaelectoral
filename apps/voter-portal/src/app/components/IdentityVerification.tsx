import { FilePlus2, KeyRound, ArrowLeft } from "lucide-react";

export type IdentityVerificationProps = {
  activeLane: "PUBLICO" | "ACCESO" | "SOPORTE";
  setActiveLane: (lane: "PUBLICO" | "ACCESO" | "SOPORTE") => void;
  errorMsg: string;
  setErrorMsg: (msg: string) => void;
  handleLookup: (e: React.FormEvent) => Promise<void>;
  dni: string;
  setDni: (val: string) => void;
  accessCode: string;
  setAccessCode: (val: string) => void;
  canLookup: boolean;
  busy: string | null;
  handlePublicEnrollmentRequest: (e: React.FormEvent) => Promise<void>;
  selfRegistrationName: string;
  setSelfRegistrationName: (val: string) => void;
  selfRegistrationEmail: string;
  setSelfRegistrationEmail: (val: string) => void;
  selfRegistrationPhone: string;
  setSelfRegistrationPhone: (val: string) => void;
  handlePublicStatusClick: () => Promise<void>;
  onBack: () => void;
};

export function IdentityVerification({
  activeLane, setActiveLane, errorMsg, setErrorMsg, handleLookup,
  dni, setDni, accessCode, setAccessCode, canLookup, busy,
  handlePublicEnrollmentRequest, selfRegistrationName, setSelfRegistrationName,
  selfRegistrationEmail, setSelfRegistrationEmail, selfRegistrationPhone, setSelfRegistrationPhone,
  handlePublicStatusClick, onBack
}: IdentityVerificationProps) {
  return (
    <div className="card p-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="section-title m-0">Verificación de Identidad</h2>
        <button onClick={onBack} className="btn-subtle !p-2 !rounded-full"><ArrowLeft size={18} /></button>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 mb-8">
        {[
          { key: "ACCESO", title: "Tengo mi Código", icon: KeyRound, desc: "Ya recibí mi código ciudadano y quiero acceder a la urna." },
          { key: "PUBLICO", title: "Crear Solicitud", icon: FilePlus2, desc: "Aún no tengo acceso y necesito que validen mi expediente." }
        ].map((lane) => (
          <div 
            key={lane.key}
            onClick={() => { setActiveLane(lane.key as any); setErrorMsg(""); }}
            className={`card p-5 cursor-pointer flex flex-col items-center text-center transition-all ${activeLane === lane.key ? 'ring-2 ring-indigo-500 bg-indigo-50' : ''}`}
          >
            <lane.icon size={32} className={`mb-3 ${activeLane === lane.key ? 'text-indigo-600' : 'text-slate-400'}`} />
            <h3 className="font-bold mb-2 text-slate-900">{lane.title}</h3>
            <p className="text-sm text-slate-500">{lane.desc}</p>
          </div>
        ))}
      </div>

      {errorMsg && <div className="card p-4 border-red-200 bg-red-50 text-red-800 mb-6">{errorMsg}</div>}

      <div className="bg-white p-6 rounded-2xl border border-slate-200">
        {activeLane === "ACCESO" ? (
          <form onSubmit={handleLookup}>
            <div className="mb-4">
              <label className="admin-label">Número de Identidad (DNI)</label>
              <input className="admin-input" placeholder="0801199912345" value={dni} onChange={(e) => setDni(e.target.value)} required />
            </div>
            <div className="mb-6">
              <label className="admin-label">Código Ciudadano</label>
              <input type="password" className="admin-input" placeholder="Ingresa tu código" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} required />
            </div>
            <button type="submit" disabled={!canLookup || !accessCode || busy !== null} className="admin-btn-primary w-full">
              {busy === "LOOKUP" ? "Verificando..." : "Acceder al Expediente"}
            </button>
          </form>
        ) : (
          <form onSubmit={handlePublicEnrollmentRequest}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="mb-4">
                <label className="admin-label">Número de Identidad (DNI)</label>
                <input className="admin-input" placeholder="0801199912345" value={dni} onChange={(e) => setDni(e.target.value)} required />
              </div>
              <div className="mb-4">
                <label className="admin-label">Nombre Completo</label>
                <input className="admin-input" placeholder="Tal como aparece en tu DNI" value={selfRegistrationName} onChange={(e) => setSelfRegistrationName(e.target.value)} required />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="mb-4">
                <label className="admin-label">Correo Electrónico</label>
                <input type="email" className="admin-input" placeholder="Para notificaciones" value={selfRegistrationEmail} onChange={(e) => setSelfRegistrationEmail(e.target.value)} />
              </div>
              <div className="mb-4">
                <label className="admin-label">Teléfono</label>
                <input className="admin-input" placeholder="Opcional" value={selfRegistrationPhone} onChange={(e) => setSelfRegistrationPhone(e.target.value)} />
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 mt-4">
              <button type="button" onClick={handlePublicStatusClick} disabled={!canLookup || busy !== null} className="btn-subtle w-full text-center py-2.5">
                {busy === "PUBLIC_STATUS" ? "Consultando..." : "Consultar Estado Existente"}
              </button>
              <button type="submit" disabled={!canLookup || !selfRegistrationName || busy !== null} className="admin-btn-primary w-full">
                {busy === "PUBLIC_REQUEST" ? "Enviando..." : "Enviar Solicitud"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
