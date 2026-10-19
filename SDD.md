# ORDERCODE — SDD 2.2

**Producto:** Harness autónomo de programación mediante IA.  
**Plataformas:** Windows 11 y macOS; Linux posteriormente.  
**Estado:** Especificación técnica, pendiente de implementación.  
**Principio:** Máxima inteligencia, mínimo consumo, orden absoluto.

## 1. Producto

OrderCode será una aplicación de escritorio para desarrollar software mediante un motor propio de agentes de IA, independiente de Pi, Codex, Claude Code y OpenCode.

**Capacidades obligatorias:** Plan/Build/Auto, agentes especializados, múltiples modelos, terminal, editor, Git, permisos, Context Intelligence, Code Intelligence, MCP, Skills, Marketplace, Agent Studio, Release Center y sesiones persistentes.

**Objetivos:** corrección, rapidez, autonomía, seguridad, transparencia, minimalismo y ahorro de tokens, tiempo, memoria y costos. Optimizar el costo por tarea correctamente completada, nunca los tokens aisladamente.

## 2. Modos

- **Plan:** investigar, analizar y planificar; sin escritura de código por defecto.
- **Build:** implementar, ejecutar herramientas, probar y corregir.
- **Auto:** decidir dinámicamente cuándo investigar, planificar, implementar y verificar.

Los tres comparten un único runtime. Auto no impone secuencias ni cuotas arbitrarias. El modo Auto es independiente del perfil de permisos Auto.

**Release Center:** módulo separado para preflight, commits, push, tags, despliegues, verificaciones y recuperación autorizada. No constituye un cuarto modo.

## 3. Arquitectura

**Stack:** Tauri 2, React, TypeScript, Vite, Tailwind CSS, Motion, Zustand, Node.js LTS, Rust, Zod, SQLite WAL, Monaco, xterm.js, PTY/ConPTY, ripgrep, FTS5, Tree-sitter, LSP y Git CLI.

**Componentes:**
- `Desktop Shell`: ventanas, UI, eventos e interacción.
- `Harness Service`: runtime propio, sesiones, modelos, herramientas, agentes, contexto y orquestación.
- `Native Broker`: procesos, terminal, operaciones privilegiadas y ejecución autorizada.
- `Shared Contracts`: protocolos, esquemas, eventos y tipos.

**Estructura:** `apps/desktop`, `apps/harness` y `packages/shared`. Separar responsabilidades sin crear procesos, capas ni dependencias innecesarias.

**IPC:** local, privado, autenticado cuando corresponda, tipado y versionado; solicitudes identificadas, eventos secuenciados, streaming, cancelación y errores estructurados. La UI no ejecutará comandos privilegiados directamente. Empaquetar el servicio sin exigir Node global y verificar Windows/macOS.

## 4. Agent Runtime

**Ciclo:** objetivo → sesión/modelo/permisos → contexto → inferencia → interpretación → validación → herramientas → evidencia → resultado compacto → actualización → continuación.

**Estados:** `CREATED`, `PREPARING`, `RUNNING`, `WAITING_APPROVAL`, `WAITING_USER`, `PAUSING`, `PAUSED`, `COMPLETED`, `FAILED`, `CANCELLED`, `RECOVERY_REQUIRED`.

**Herramientas:** identificador, esquema, capacidades, efectos, cancelabilidad, resultado estructurado y evidencia recuperable. Efectos: `READ`, `WRITE`, `EXECUTE`, `NETWORK`, `GIT_WRITE`, `PUBLISH`, `DESTRUCTIVE`.

**Continuidad:** eventos durables, checkpoints seguros, recuperación de sesiones y reconciliación de procesos. No repetir operaciones no idempotentes con resultados inciertos.

**Control:** presupuestos, cancelación y detección contextual de bucles; sin límites universales arbitrarios de pasos.

**Hasta completar:** activación por tarea desde el chat. La guía del modelo pide criterios verificables y continuación del ciclo de herramientas hasta verificarlos o encontrar un bloqueo. Conserva el modo, especialista, modelo, permisos y presupuestos elegidos. El indicador se recupera de eventos y checkpoints, incluida la espera de autorizaciones; se desactiva para tareas posteriores al finalizar. El puente nativo no impone un corte adicional de 15 minutos a las ejecuciones. La evaluación de cumplimiento depende del modelo y no implica ejecución autónoma después de cerrar la aplicación.

## 5. Model Hub

**Proveedores:** OpenRouter, OpenAI, OpenCode Console, Anthropic, xAI, Gemini, Ollama, LM Studio y endpoints compatibles; otros mediante adaptadores autorizados. OpenCode Console admite su API con créditos y clave; su nivel gratuito está restringido a su propia aplicación y no puede ofrecerse como disponible en OrderCode. Modelos gratuitos de otros proveedores requieren las credenciales y cuotas que estos establezcan; los modelos locales no requieren una clave API externa.

**Adaptadores:** autenticación, descubrimiento, capacidades, streaming, tool calling, cancelación, caché, métricas, límites y errores normalizados, según soporte real.

**Selector:** dentro del chat, con búsqueda, recientes, favoritos, proveedores, capacidades, disponibilidad, precios, modelos locales y filtro Free Only.

**Esfuerzo:** selector de niveles propios del modelo cuando el proveedor exponga soporte verificable. Automático conserva el valor predeterminado; la elección se persiste por sesión y se hereda por los especialistas. Rechazar niveles incompatibles antes de inferencia y volver a Automático al cambiar a un modelo que no admita la elección actual.

**Free Only:** bloquear inferencia pagada y fallbacks pagados; precio desconocido no equivale a gratuito. Revalidar promociones y límites. OrderCode no financiará la inferencia del nivel gratuito ni prometerá acceso ilimitado de terceros.

**Suscripciones:** únicamente integraciones oficiales y autorizadas; no asumir que ChatGPT, Grok u otras suscripciones incluyen acceso API.

**Conexiones de planes:** ChatGPT mediante consentimiento delegado; Grok mediante código de dispositivo xAI y acceso a Grok Build habilitado en la cuenta; MiniMax M Plan mediante clave de suscripción `sk-cp-` y catálogo limitado a los modelos documentados para ese plan. Ajustes separa Suscripciones, Claves API y Locales. Comprobar modelos consulta el catálogo autenticado, sin ejecutar inferencia; no garantiza cuota disponible. No ofrecer acceso Claude Pro/Max ni Z.AI Coding Plan como integrado cuando el proveedor no autorice OrderCode.

**Seguridad y gasto:** secretos en almacenes seguros; presupuestos por sesión, proyecto y proveedor; costos exactos, estimados o desconocidos claramente diferenciados.

## 6. Agentes

**Oficiales:** General, Explore, Architect, Build, Debug, QA, Security y Review.

**Delegación:** automática cuando aporte valor, con paralelismo únicamente en tareas independientes y coordinación de escrituras. Evitar especialistas redundantes.

**Herencia:** todos utilizan el modelo de la conversación y permisos iguales o más restrictivos que el agente principal. Prohibidos los cambios silenciosos de modelo.

**Agent Studio:** crear, editar, configurar, probar, activar, importar y exportar agentes; herramientas, instrucciones, capacidades, MCP, Skills y permisos. Sin modelo independiente por agente.

## 7. Context Intelligence — Optimización de tokens

Subsistema prioritario desde el primer runtime funcional, no una mejora añadida al final.

**Context Builder:** construir cada solicitud con objetivo, estado, instrucciones esenciales, decisiones, historial relevante, código necesario, herramientas pertinentes y evidencias. Excluir información redundante u obsoleta.

**Recuperación progresiva:** referencias → búsqueda exacta → símbolos → fragmentos → grafo → búsqueda semántica opcional → verificación en fuente. No cargar repositorios completos por defecto.

**Tool Result Optimizer:** transformar resultados extensos en estado, código de salida, diagnósticos, resumen y `logRef`. Conservar errores críticos y salida original recuperable.

**Logs:** stdout/stderr completos almacenados localmente; el modelo recibe resultados mínimos suficientes y puede solicitar rangos, filtros o detalles. Nunca reinyectar logs masivos automáticamente.

**Herramientas y Skills:** descubrimiento y carga progresiva; incluir únicamente esquemas necesarios. Evitar enviar catálogos MCP completos en cada solicitud.

**Caché:** reutilizar contexto estático, índices, fragmentos, resultados verificables y caché del proveedor cuando corresponda; invalidar ante modificaciones relevantes.

**Compactación:** Manual, Auto y Conservadora; decisión adaptativa según presión, relevancia, redundancia, riesgo y costo. Preservar objetivos, decisiones, cambios, errores, pruebas y referencias. Mantener historial original.

**Memoria:** separar historial, contexto activo, memoria operativa, checkpoints y evidencias; recuperar información verificable sin reconstruir toda la conversación.

**Delegación eficiente:** enviar contexto mínimo suficiente a cada subagente y recuperar resultados estructurados, evitando historiales duplicados.

**Métricas:** tokens de entrada/salida, caché, gasto, tiempo, relecturas, llamadas, compactaciones, reintentos y costo por tarea correcta. Identificar estimaciones.

**Regla:** menos tokens solo constituye una mejora si no deteriora injustificadamente precisión, seguridad o tiempo total.

**Verificación de eficiencia:** medir reducciones contra el contenido original en el punto real de compactación, con metadatos internos; nunca deducir ahorro de marcadores o cifras presentes en archivos, logs o resultados externos. Las cifras por caracteres son estimaciones. El grafo es recuperación opcional: su ahorro depende de las lecturas que sustituya y puede añadir contexto frente a una búsqueda exacta. Los benchmarks locales de índice o transporte no demuestran superioridad de inferencia frente a otros productos; esa comparación exige tareas equivalentes, mismo modelo/proveedor y calidad verificada.

## 8. Code Intelligence

**Motor propio:** Tree-sitter + LSP + ripgrep + SQLite/FTS5 + grafo estructural.

**Lenguajes iniciales:** TypeScript, JavaScript, Python y Rust.

**Pipeline:** descubrir → filtrar → parsear → extraer símbolos → resolver relaciones → persistir → actualizar incrementalmente.

**Entidades:** archivos, módulos, símbolos, funciones, clases, métodos, endpoints, dependencias y pruebas.

**Relaciones:** `IMPORTS`, `DEFINES`, `CALLS`, `REFERENCES`, `IMPLEMENTS`, `EXTENDS`, `TESTS`, `DEPENDS_ON`.

**Eficiencia:** indexación incremental, hashes, caché, recuperación selectiva y trabajo sin bloquear la UI. No enviar grafos completos ni generar embeddings remotos por defecto.

**Integración:** consultas de símbolos, referencias, dependencias e impacto para agentes; explorador visual bajo demanda. Diferenciar relaciones confirmadas de inferidas.

## 9. Permission Engine

**Perfiles:** Lectura, Guiado, Auto y Avanzado.

**Alcance:** usuario, proyecto, sesión, agente, herramienta, acción, ruta, destino y duración.

**Aprobaciones:** rechazar, permitir una vez, durante la sesión o mediante regla limitada al proyecto.

**Garantías:** validación en ejecución, permisos heredados restrictivamente, normalización segura de rutas, protección frente a escalada, prompt injection y operaciones externas no confiables.

La autorización del modelo no sustituye controles nativos. Identificar operaciones sin sandbox real. Publicaciones y gastos externos requieren autorización correspondiente.

## 10. Herramientas de desarrollo

**Terminal:** PowerShell, CMD, Bash y Zsh según plataforma; PTY interactivo, pestañas, historial, búsqueda, cancelación, procesos y logs persistentes.

**Process Explorer:** procesos administrados, agentes, herramientas, PID, estado, duración, recursos, errores y referencias. Distinguir procesos externos.

**Editor:** Monaco, pestañas, archivos, edición, búsqueda, símbolos, diagnósticos y diffs integrados con el chat.

**Visualizador:** vista Web integrada para direcciones HTTPS y servidores de desarrollo locales, dentro de un marco aislado sin acceso a IPC de OrderCode. La vista Gráficas descubre resultados PNG, JPEG, GIF, WebP, AVIF, BMP, SVG y HTML entre archivos del proyecto y archivos modificados por tareas. El HTML de proyecto se muestra en un marco estático aislado, sin ejecutar scripts ni cargar recursos externos. Para contenido interactivo se usa el servidor local en la vista Web. No enviar estos archivos al modelo por abrirlos en el visualizador.

**Git:** estado, ramas, staging, historial, commits, diffs, conflictos, worktrees y operaciones remotas autorizadas. Preservar cambios preexistentes; worktrees no equivalen a sandbox.

## 11. Extensiones

**MCP Manager:** servidores locales/remotos, conexión, autenticación, herramientas, permisos, estado y desconexión.

**Skills Manager:** compatibilidad con `SKILL.md`, recursos asociados, instalación, creación, edición, activación, importación y carga progresiva.

**Marketplace:** fuentes autorizadas, búsqueda, instalación y actualización; mostrar origen, publicador, versión, permisos y riesgos. No ejecutar instaladores arbitrarios silenciosamente.

Todas las herramientas externas pasarán por el Permission Engine.

## 12. Persistencia y observabilidad

**SQLite WAL:** transacciones, claves foráneas, migraciones, índices, integridad, backups y recuperación.

**Entidades:** proyectos, sesiones, mensajes, modelos, agentes, ejecuciones, eventos, herramientas, procesos, permisos, uso, contexto, checkpoints, índices, extensiones y Git.

**Logs:** almacenamiento separado de las filas transaccionales principales, con referencias, retención y protección de datos sensibles.

**Event Log:** identificador, ejecución, secuencia, timestamp, tipo y payload validado.

**Observabilidad:** filtrar actividad, herramientas, agentes, errores, tokens, costos, permisos, procesos, compactaciones y cambios. Datos reales y evidencia recuperable.

**Privacidad:** local-first, credenciales protegidas y control sobre información enviada a terceros.

## 13. Interfaz

`DESIGN.md` define identidad, composición, navegación, componentes, animaciones y accesibilidad.

**Flujo:** proyecto → modelo → Plan/Build/Auto → conversación → ejecución → resultado.

**Navegación:** Conversación, Proyecto e Historial; herramientas avanzadas agrupadas en Herramientas y configuración en Ajustes. Incluye el visualizador integrado de Web y gráficas. Release Center sigue siendo un módulo independiente dentro de Herramientas. Inicio guiado: abrir carpeta y conectar modelo. El modo inicial es Auto, con permisos Guiado.

**Paneles contextuales:** editor, diffs, terminal, procesos, logs, contexto, Git y Release Center.

**Reglas:** chat principal; selectores desplegables compactos; paneles secundarios ocultos por defecto; actividad resumida y expandible; permisos visibles; nada decorativo sin funcionalidad.

**Rendimiento objetivo:** 60 FPS, arranque en caliente inferior a 2 segundos, listas virtualizadas y Reduced Motion. Verificación mediante mediciones reales.

## 14. Seguridad y calidad

**Seguridad:** privilegios mínimos, secretos protegidos, límites de rutas/red, separación entre instrucciones y datos externos, protección contra prompt injection, aislamiento apropiado, auditoría y recuperación.

**Pruebas:** unitarias, integración, E2E, seguridad, recuperación, rendimiento y empaquetado.

**Primera prueba obligatoria (13 pasos):** abrir repositorio → crear sesión → seleccionar modelo → Build → solicitar modificación → autorizar herramientas → modificar archivos → ejecutar pruebas → mostrar resultados/errores → revisar diff → guardar sesión → cerrar aplicación → recuperar estado.

Probar herramientas y persistencia reales. Las simulaciones deterministas no sustituyen pruebas de integración con un proveedor real autorizado.

**Aceptación:** `PASS`, `FAIL`, `BLOCKED`, `NOT_TESTED`, `NOT_IMPLEMENTED`. No declarar funcionalidades, integraciones ni compatibilidad multiplataforma sin evidencia.

## 15. Hoja de ruta

- **M0:** Tauri, frontend, servicio, IPC y SQLite.
- **M1:** runtime, herramientas, permisos y optimización básica de contexto.
- **M2:** chat, Plan/Build/Auto, editor, terminal, Git y diffs.
- **M3:** proveedores, presupuestos y Free Only.
- **M4:** contexto avanzado, caché, compactación y memoria.
- **M5:** indexación, búsqueda estructural y grafo.
- **M6:** especialistas, delegación y Agent Studio.
- **M7:** MCP, Skills y Marketplace.
- **M8:** procesos avanzados, automatización y Release Center.
- **M9:** seguridad, rendimiento, distribución y beta.

**Prioridades:** P0 = M0–M2; P1 = M3–M6; P2 = M7–M9. Primero completar el recorrido funcional real. La optimización básica de contexto pertenece a P0.

## 16. Contrato de implementación

**Documentos principales:** `SDD.md`, `DESIGN.md` y `AGENTS.md`. No depender de `PLAN.md` ni `STATE.md`; ADR únicamente para decisiones arquitectónicas significativas.

**Estrategia:** un Plan nativo de Codex y un Build autónomo con implementación, integración, verificación y corrección internas, sujeto a los límites reales de ejecución y permisos.

**Prohibido:** sustituir el motor propio, llamadas pagadas ocultas, modelos distintos por subagente, duplicar documentación, crear funcionalidades simuladas, reinyectar logs completos, usar cachés obsoletas, repetir trabajos innecesarios, publicar sin autorización o declarar éxito sin pruebas.

**Producto terminado:** aplicación estable que desarrolla software mediante agentes propios, modelos configurables, Plan/Build/Auto, permisos efectivos, herramientas reales, contexto eficiente, inteligencia estructural, extensiones y recuperación verificable.

**Principio final: máxima corrección y autonomía, mínimo tiempo, tokens, costos y complejidad.**
