export interface OfficialAgent {
  id: string;
  name: string;
  detail: string;
}

export const OFFICIAL_AGENTS: OfficialAgent[] = [
  { id: 'general', name: 'General', detail: 'Coordina el trabajo y responde consultas generales.' },
  { id: 'explore', name: 'Explore', detail: 'Investiga el repositorio sin modificar archivos.' },
  { id: 'architect', name: 'Architect', detail: 'Analiza estructura, límites y opciones técnicas.' },
  { id: 'build', name: 'Build', detail: 'Implementa cambios autorizados y verifica el resultado.' },
  { id: 'debug', name: 'Debug', detail: 'Reproduce fallos y rastrea sus causas.' },
  { id: 'qa', name: 'QA', detail: 'Comprueba criterios y casos límite.' },
  { id: 'security', name: 'Security', detail: 'Revisa rutas, permisos, secretos y efectos externos.' },
  { id: 'review', name: 'Review', detail: 'Revisa cambios, errores y regresiones.' },
];
