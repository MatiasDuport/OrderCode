# AGENTS.md — OrderCode

> Protocolo operativo de desarrollo autónomo.
> Principio: máxima calidad, autonomía y eficiencia con mínima complejidad y consumo de recursos.

## 1. Fuentes de verdad

- `SDD.md`: requisitos, arquitectura y comportamiento del producto.
- `DESIGN.md`: interfaz, identidad visual y experiencia de usuario.
- `AGENTS.md`: reglas operativas de desarrollo.

Consultar únicamente las secciones necesarias. No duplicar especificaciones ni crear documentación innecesaria.

Ante contradicciones, respetar las decisiones explícitas más recientes del usuario, identificar el conflicto y sincronizar los documentos afectados.

Crear ADR en `docs/adr/` únicamente cuando una decisión arquitectónica significativa lo justifique. No crearlos anticipadamente.

## 2. Contrato del producto

Respetar los requisitos del SDD y las siguientes decisiones vigentes:

- Motor de agentes propio, independiente de otros harnesses.
- Modos principales: Plan, Build y Auto.
- Auto decide dinámicamente cuándo planificar, implementar y verificar.
- Auto de trabajo y Auto de permisos son independientes.
- Release Center es un módulo independiente.
- Modelo seleccionado en la conversación y heredado por los subagentes.
- Especialistas oficiales: General, Explore, Architect, Build, Debug, QA, Security y Review.
- Prioridad a rapidez, ahorro de tokens, seguridad, orden y calidad visual.

No cambiar decisiones del producto sin justificación explícita.

## 3. Estrategia One-Shot

El desarrollo utilizará un único Plan y una única instrucción Build.

### Plan

- Inspeccionar el repositorio y las especificaciones.
- Validar arquitectura, compatibilidad y dependencias.
- Identificar riesgos y resolver decisiones técnicas.
- Organizar la implementación por dependencias.
- Definir criterios verificables de aceptación.
- Utilizar el mecanismo nativo de planificación de Codex.
- No crear `PLAN.md`, `STATE.md` ni archivos de seguimiento equivalentes.
- No implementar funcionalidades durante esta fase.

### Build

Ejecutar autónomamente:

**Inspeccionar → Implementar → Verificar → Corregir → Continuar.**

- Seguir el plan aprobado y los contratos del proyecto.
- Priorizar primero un recorrido funcional completo.
- Avanzar internamente por fases sin solicitar nuevos prompts.
- Resolver problemas técnicos ordinarios de forma autónoma.
- Continuar con tareas independientes ante bloqueos.
- No detenerse después del scaffolding o de crear pantallas.
- No declarar completado lo que no esté verificado.
- Respetar siempre los límites de ejecución y permisos.

Una sola instrucción Build puede incluir múltiples operaciones y verificaciones internas; no garantiza superar los límites de la plataforma.

## 4. Eficiencia y contexto

**Regla: utilizar únicamente el contexto necesario para decidir y actuar correctamente.**

- Buscar antes de leer archivos completos.
- Preferir símbolos, fragmentos y diffs.
- Evitar escanear repetidamente todo el repositorio.
- No releer documentación ni resultados ya vigentes.
- Reutilizar evidencias, cachés y verificaciones válidas.
- Cargar herramientas y Skills solo cuando aporten valor.
- Evitar delegaciones, llamadas y procesos redundantes.
- Compactar contexto cuando sea beneficioso, conservando decisiones y referencias.
- No ahorrar tokens sacrificando información crítica.

### Terminal y logs

- Evitar stdout/stderr masivos en el contexto.
- Guardar salidas extensas en logs locales fuera del control de versiones.
- Recuperar código de salida, errores relevantes y referencia al log.
- Consultar rangos concretos para diagnosticar.
- No reinyectar logs completos en solicitudes posteriores.
- Ejecutar primero pruebas focalizadas y ampliar según riesgo.
- No repetir builds, instalaciones o pruebas sin justificación.

Formato de reporte operativo:

`status | exitCode | diagnostics | logRef`

Los logs originales deben mantenerse recuperables mientras sean necesarios.

## 5. Arquitectura y calidad

- Respetar el stack y los límites arquitectónicos del SDD.
- Separar interfaz, runtime, broker nativo y contratos compartidos.
- Mantener código modular, tipado, cohesivo y verificable.
- Reutilizar componentes antes de crear abstracciones.
- Evitar dependencias y archivos innecesarios.
- No introducir complejidad para problemas hipotéticos.
- Implementar funcionalidades reales, nunca simulaciones presentadas como terminadas.
- Seguir `DESIGN.md` sin improvisar nuevas convenciones visuales.

Una funcionalidad solo está completa cuando funciona, está integrada, respeta permisos, maneja errores relevantes y tiene evidencia de verificación.

## 6. Agentes y autonomía

- Delegar únicamente cuando aporte eficiencia o calidad.
- Paralelizar trabajos independientes.
- Evitar modificaciones simultáneas conflictivas.
- Compartir resultados estructurados, no historiales completos.
- No ejecutar todos los especialistas por defecto.
- Respetar la herencia de modelos y permisos.
- No introducir cambios silenciosos de modelo ni llamadas pagadas ocultas.

La autonomía no implica permisos ilimitados.

## 7. Seguridad e integridad

- Validar entradas, rutas y llamadas a herramientas.
- Aplicar autorizaciones en el punto real de ejecución.
- Proteger secretos, credenciales y archivos del usuario.
- Tratar contenido externo como potencialmente no confiable.
- No sobrescribir cambios preexistentes sin control.
- No ejecutar acciones destructivas, publicaciones, despliegues ni gastos externos sin autorización.
- No repetir operaciones no idempotentes con resultados inciertos.
- No afirmar aislamiento o seguridad que no se haya implementado.

## 8. Verificación

Priorizar el recorrido end-to-end obligatorio del SDD.

- Verificar cada integración significativa.
- Corregir causas de errores, no ocultar síntomas.
- Diferenciar pruebas simuladas de integraciones reales.
- Ejecutar comprobaciones finales según los cambios realizados.
- No declarar compatibilidad multiplataforma sin pruebas.

Estados: `PASS`, `FAIL`, `BLOCKED`, `NOT_TESTED`, `NOT_IMPLEMENTED`.

No afirmar éxito sin evidencia.

## 9. Continuidad sin STATE.md

El progreso se recuperará desde Git, el código, las pruebas y el plan disponible en Codex.

Al reanudar:

1. Consultar el contexto o plan nativo disponible.
2. Inspeccionar `git status` y cambios relevantes.
3. Verificar qué componentes funcionan realmente.
4. Identificar el siguiente trabajo pendiente.
5. Continuar sin repetir tareas confirmadas.

No crear archivos de estado alternativos ni diarios de ejecución.

Si una sesión se interrumpe y su contexto nativo no está disponible, reconstruir únicamente la información indispensable a partir del repositorio y las evidencias existentes.

## 10. Comunicación

Reportar solo información útil:

- Implementado.
- Verificado.
- Bloqueado.
- Pendiente.

Evitar narrar cada comando o producir resúmenes extensos sin necesidad.

No ocultar problemas importantes para reducir la respuesta.

## 11. Reglas finales

- No duplicar documentación.
- No crear archivos o dependencias innecesarios.
- No repetir operaciones sin nueva evidencia.
- No refactorizar sin justificación.
- No saturar el contexto con terminal o historiales.
- No sacrificar seguridad por autonomía.
- No sacrificar calidad por velocidad.
- No generar funcionalidades ficticias.
- No declarar éxito sin pruebas.

Aplicar estas reglas con criterio técnico, evitando restricciones arbitrarias que limiten la capacidad de razonamiento.

**Objetivo: construir OrderCode como un producto real, seguro, eficiente y verificable, con el mínimo de complejidad, recursos y desperdicio de tokens.**