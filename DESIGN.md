
# OrderCode - DESIGN.md

> **Versión:** 1.3  
> **Estado:** Contrato de diseño para Plan y Build  
> **Plataformas:** Windows y macOS; Linux posteriormente  
> **Principio:** Máxima capacidad, mínima interfaz.

## 0. Propósito y alcance

Este documento define exclusivamente la **identidad, composición, interacciones y calidad visual** de OrderCode, un entorno de escritorio para programar con agentes de IA. Debe permitir implementar la interfaz de forma consistente en una sola ejecución Build, sin improvisar nuevas convenciones en cada pantalla.

- `SDD.md` es la fuente de verdad para capacidades, arquitectura, seguridad y comportamiento técnico.
- `DESIGN.md` es la fuente de verdad para experiencia, interfaz y lenguaje visual.
- El plan nativo de Codex define la secuencia de implementación y verificación. La continuidad se recupera desde Git, el código, las pruebas y el contexto de Codex, según `AGENTS.md`; no crear `PLAN.md`, `STATE.md` ni archivos equivalentes.
- Una divergencia sustancial se resuelve explícitamente mediante ADR, no por cambios silenciosos.
- No se duplican aquí esquemas de datos, contratos de herramientas ni especificaciones internas del runtime.

Las referencias de experiencia son la **densidad funcional de OpenCode** y la **claridad conversacional de Claude Code**, sin reproducir su identidad visual o interfaz literalmente. OrderCode debe tener personalidad propia.

Referencia visual editable: [índice de pantallas de OrderCode en Figma](https://www.figma.com/design/eLTovJ7gmqwvEnfAQ9nBAs?node-id=26-6313). El prototipo incluye 50 vistas y 8 ventanas contextuales; sus datos son ilustrativos. En implementación, las capacidades y estados reales se rigen por `SDD.md`, y las reglas de interfaz de este documento prevalecen sobre ejemplos del prototipo.

## 1. Reglas rectoras de experiencia

1. **Conversación primero.** El usuario abre un proyecto y trabaja inmediatamente desde el chat.
2. **Densidad controlada.** Herramientas poderosas, controles compactos, espacios aprovechados; nada sobredimensionado.
3. **Revelación progresiva.** Ocultar lo accesorio hasta que una acción o el usuario lo requieran.
4. **Una función, un lugar principal.** No duplicar controles o información entre barras y paneles.
5. **Estados reales.** Toda indicación de actividad, gasto, permiso o resultado se vincula al estado real de la aplicación.
6. **Sin ruido.** Reducir tarjetas, rótulos, banners, divisores, paneles permanentes y animaciones ornamentales.
7. **Control sin fricción.** Modelo, modo, permisos, cancelación y resultados accesibles desde el contexto de trabajo.
8. **Uso experto y principiante.** Camino principal simple; atajos, búsqueda y controles avanzados bajo demanda.

## 2. Identidad de OrderCode

### 2.1. Logo

- Usar el **isotipo de cubo geométrico minimalista** seleccionado para OrderCode como identidad primaria.
- Variantes: isotipo solo, isotipo con texto `OrderCode`, monocromática y versiones para superficies claras/oscuras.
- Preservar la geometría del archivo maestro aprobado; no redibujar automáticamente el cubo ni sustituirlo por un icono genérico.
- El isotipo debe ser legible en tamaños pequeños, por ejemplo en navegación y barra de ventana.
- Si el recurso definitivo no está presente en el repositorio, usar un marcador neutro **identificado como provisional**. No inventar un logo definitivo.

### 2.2. Tipografía

- **Interfaz:** Nunito, pesos 400, 500, 600 y 700; usar la menor cantidad posible de variantes.
- **Código, diffs y terminal:** fuente monoespaciada legible y configurable; preferencia por JetBrains Mono si está disponible, con fallback del sistema.
- Texto ordinario compacto y confortable: referencia 13-14 px; texto secundario 11-12 px; títulos de panel 13-15 px; títulos de vista 23-26 px; estado inicial de conversación 25-36 px como única invitación principal.
- Evitar encabezados gigantes, texto en mayúsculas de forma generalizada y pesos excesivos.
- No cargar familias tipográficas adicionales sin justificación.

### 2.3. Paleta base: Ion Spectrum

| Token | Hex | Uso principal |
|---|---|---|
| Ion Green | `#BDFB62` | Acción primaria, foco selectivo, ejecución positiva |
| Neural Blue | `#83AAFF` | Información, navegación y relaciones |
| Quantum Violet | `#AA94F9` | Orquestación, subagentes y acentos secundarios |
| Obsidian | `#0B0F14` | Fondo oscuro base |
| Graphite | `#161C25` | Paneles y superficies elevadas |
| Steel | `#2A3442` | Bordes, separadores y superficies de control |
| Frost White | `#EDF3F9` | Texto principal en oscuro; base clara |
| Slate | `#95A3B7` | Texto secundario y metadatos |

Aplicación de la paleta:

- **Dark por defecto.** Superficies predominantemente neutras; el verde, azul y violeta se usan con moderación.
- **Light completo.** Fondo `#F7F8F5`, superficies blancas y acento verde `#426626`, texto oscuro con contraste suficiente, bordes neutros; ajustar los tonos de acento usados como texto para cumplir contraste. No invertir los colores ciegamente.
- **Semántica adicional:** error, advertencia y éxito deben diferenciarse también por icono y texto, nunca solo por color. Definir tokens semánticos accesibles en implementación.
- **Degradados Ion Spectrum:** usar verde → azul → violeta en bordes, selección, controles primarios y títulos puntuales. Aplicar halos radiales suaves de azul y violeta detrás del compositor, con superficies oscuras legibles. El tema claro conserva la misma paleta con texto de acento más oscuro.
- **Regla de contención:** no más de uno o dos acentos visuales intensos simultáneos en la vista principal.
- Sin neón generalizado, brillos permanentes, transparencias costosas ni efectos de cristal aplicados por defecto a todos los paneles.

## 3. Tokens de densidad y componentes

Estas dimensiones son **objetivos de referencia**, no límites rígidos; adaptarlas por plataforma, escalado y accesibilidad.

| Elemento | Objetivo compacto |
|---|---|
| Iconografía habitual | 14-16 px, consistente |
| Controles de barra / menús | 30-32 px de alto |
| Área interactiva de iconos | Aproximadamente 28-32 px; ampliar según accesibilidad |
| Barra superior | 48 px |
| Rail de navegación | 56 px contraído; etiquetas en una capa de 190 px al pasar el cursor o recibir foco |
| Sidebar desplegada | 200-240 px, redimensionable |
| Panel contextual | 280-340 px cuando exista espacio |
| Terminal expandida | Altura ajustable; oculta inicialmente |
| Radio de controles | 8-10 px; composer 12-16 px |
| Separadores | 1 px y bajo contraste |
| Espaciado | Escala reducida: 4, 6, 8, 12, 16, 24 px |

- Botones y selectores compactos; **no llenar la pantalla de chips, pastillas o botones grandes**.
- Preferir iconos de una familia consistente (por ejemplo, Lucide). Todo icono sin texto debe tener tooltip y nombre accesible.
- Usar contenedores planos y separadores discretos en lugar de encerrar todo en tarjetas.
- No usar sombras profundas como estructura de la interfaz; reservar elevación para menús y superposiciones.
- Un solo control primario por contexto; los demás son secundarios o están en menús.
- Diferenciar hover, focus, pressed, selected y disabled sin depender solo de cambios cromáticos mínimos.

## 4. Orden espacial y navegación

La interfaz es un **workbench adaptable**, no un dashboard. Solo la conversación y sus controles fundamentales tienen prioridad permanente.

### 4.1. Barra superior

Mostrar: proyecto activo, conversación actual cuando proceda, estado general compacto, búsqueda/command palette y acciones para controlar la disposición de paneles. Evitar duplicar aquí el selector de modelo, el modo o los permisos del composer.

### 4.2. Navegación lateral

- Rail compacto de iconos con nombres accesibles. Al pasar el cursor o navegar por teclado, revelar las etiquetas en una capa superpuesta, sin desplazar el contenido. En táctil los accesos funcionan por pulsación.
- Secciones: Workspace, Sessions, Agents, Code Intelligence, Extensions, Activity y Settings.
- Agrupar los accesos menos frecuentes para no presentar siete paneles abiertos a la vez.
- El explorador empieza contraído. El panel asociado muestra solo el árbol o lista necesaria y se puede contraer por completo.
- En proyectos con muchas sesiones, búsqueda y elementos recientes antes que listas interminables.

### 4.3. Área central

- Conversación como vista predeterminada, con ancho de lectura contenido para que las líneas no sean excesivas.
- Editor o diff junto al chat **únicamente** cuando el usuario lo abra o una tarea requiera revisión visible.
- La división entre chat y editor es ajustable; permitir maximizar temporalmente cualquiera.
- No reservar espacio vacío para un inspector que no está en uso.

### 4.4. Panel contextual derecho

Oculto por defecto. Aparece para archivos, cambios, actividad de agentes, detalles de ejecución, contexto, uso o autorizaciones. Solo un contexto principal a la vez. Debe cerrarse y recordarse su estado sin interferir con la conversación.

### 4.5. Panel inferior

Oculto por defecto; incluye Terminal, Processes, Logs y Problems como vistas alternables. Tamaño ajustable. No transmitir todo el stdout del agente al chat.

### 4.6. Adaptación

- En ventanas anchas, admitir chat + editor y un inspector opcional.
- Cuando el ancho sea limitado, contraer primero el inspector, luego la sidebar y finalmente pasar a una sola vista de trabajo con alternancia rápida.
- Nunca forzar tres columnas estrechas simultáneas.
- Respetar zoom, escalado de pantalla, barras nativas y redimensionamiento de ventana.

## 5. Conversación: experiencia principal

### 5.1. Mensajes

- Texto y bloques de código legibles, copiables y sin contenedores gigantes.
- Referencias a archivos, símbolos, diffs, pruebas y logs deben abrir su destino real.
- Las llamadas de herramientas aparecen **colapsadas por defecto** en grupos por fase o tarea; mostrar nombre, estado y resumen, con detalles expandibles.
- En ejecuciones largas, actualizar un bloque de actividad existente en vez de añadir decenas de tarjetas nuevas.
- La respuesta final del agente prioriza resultado, archivos afectados, verificación y pendientes; ampliación solo bajo demanda.
- Conservar desplazamiento y lectura mientras llegan eventos en streaming; no desplazar forzosamente si el usuario consulta mensajes anteriores.

### 5.2. Composer compacto

El campo de mensaje permanecerá accesible en la parte inferior del chat.

- Altura inicial mínima, adaptada al texto; crecimiento limitado y scroll interno cuando sea necesario.
- Elementos indispensables: entrada, adjuntar/referenciar, **selector de modelo**, **selector de modo**, acceso a permisos y enviar/detener.
- Los controles secundarios se agrupan en un menú de más acciones cuando falta espacio.
- No introducir grandes paneles explicativos dentro del composer.
- Botón enviar solo si hay contenido válido; durante ejecución, acceso inequívoco a detener.

### 5.3. Selector de modelo

**Un desplegable, no un conjunto de botones permanentes.** Debe mostrar el modelo activo de forma abreviada e incluir búsqueda, recientes, favoritos, proveedor, capacidad relevante, disponibilidad y distinción Free/paid/local.

- Precio, límites y privacidad se consultan en detalle, no ocupan permanentemente la barra.
- Filtro **Free Only** visible dentro del selector o de sus opciones.
- Cuando el modelo no está configurado, ofrecer una acción clara para conectarlo.
- Los subagentes heredan el modelo de la conversación: no mostrar selectores por agente.
- Los cambios no deben ocultar operaciones ya iniciadas ni sus parámetros reales.

### 5.4. Selector de modo

**Un único desplegable compacto**, nunca tres botones o pestañas permanentes:

- `Plan`: investigar y planificar sin editar código por defecto.
- `Build`: implementar y verificar.
- `Auto`: decidir dinámicamente cuándo explorar, planificar, implementar y verificar.

El valor elegido es visible en reposo. Cuando `Auto` está trabajando, una indicación discreta puede informar la fase interna actual.

**No confundir:** `Auto` (modo de trabajo) y `Auto` (perfil de permisos) son ajustes diferentes. El permiso se ubica en un control independiente e identificado como tal.

**Release no es un cuarto modo**; se accede al Release Center desde Git o el resultado de una tarea.

### 5.5. Aprobaciones

Insertar una solicitud contextual, pequeña y clara: acción, recurso afectado, riesgo y opciones para rechazar, permitir una vez, permitir durante la sesión o crear una regla limitada. No ocultar la autorización crítica en un toast efímero.

## 6. Subagentes y orquestación

Agentes oficiales: **General, Explore, Architect, Build, Debug, QA, Security y Review**.

- Mostrar solo los agentes que están actuando; no ocho tarjetas permanentes.
- Cada subagente activo presenta nombre, tarea, estado y un acceso a su actividad detallada.
- Las delegaciones paralelas se agrupan bajo la misma tarea y pueden desplegarse individualmente.
- Los resultados aparecen como síntesis con enlaces a evidencias, no como conversaciones internas duplicadas.
- `Agents` permite consultar, crear, editar, activar, desactivar, importar y probar configuraciones sin configurar modelos diferentes para cada uno.
- Los estados deben distinguir running, waiting approval, paused, failed, cancelled y completed.

## 7. Superficies de trabajo secundarias

### 7.1. Workspace y Sessions

Apertura de carpeta/repositorio, proyectos recientes, cambio de proyecto y sesiones por proyecto. El usuario debe volver al chat del proyecto en una acción. Búsqueda, reciente y favorito sustituyen listados gigantes.

### 7.2. Editor y diffs

Editor real con pestañas, explorador opcional, navegación de símbolos y diagnósticos. Abrir archivos citados desde el chat. Vista de diff clara con archivos y líneas afectadas, agrupada por ejecución. No mostrar controles para revertir cuando la reversión no sea segura o esté disponible.

### 7.3. Terminal, Process Explorer y logs

Pestañas compactas, selección de proceso y búsqueda. El chat recibe resúmenes con enlace al registro original. La actividad larga se virtualiza y no bloquea el renderizado.

### 7.4. Activity y contexto

Vista filtrable por sesión, agente, tarea, herramienta y estado. Permitir consultar progreso, costes exactos o estimados, tokens, compactaciones y checkpoints sin ocupar la conversación habitualmente. Lo estimado siempre debe etiquetarse.

### 7.5. Code Intelligence

Búsqueda primero; grafo de dependencias y relaciones como vista bajo demanda. Cada nodo debe enlazar al archivo y símbolo real. No abrir visualizaciones complejas por defecto.

### 7.6. Extensions y Model Hub

MCP, Skills y Marketplace bajo un acceso unificado a Extensions. Los proveedores, credenciales, presupuestos y modelos locales se gestionan en Settings/Models & Providers; el selector del composer sirve para elegir, no para administrar conexiones completas.

### 7.7. Git y Release Center

Git, historial y cambios accesibles desde el contexto del proyecto. Release Center agrupa preparación, commit, push, tags, deploy y verificación posterior con estados y autorizaciones explícitas. No es un modo de conversación ni ocupa una zona permanente.

## 8. Estados de interfaz

Definir componentes reutilizables para:

- **Empty:** invitación concreta a abrir proyecto, conectar modelo o iniciar conversación; sin pantallas de bienvenida gigantes.
- **Loading/streaming:** progreso discreto sin bloquear lectura o entradas ajenas a la tarea.
- **Running:** mostrar actividad y posibilidad real de cancelar.
- **Waiting approval:** mantener visible la acción que necesita decisión.
- **Paused/interrupted:** distinguir pausa, cancelación y recuperación requerida.
- **Success:** resultado y evidencia verificable, sin celebraciones invasivas.
- **Failure:** causa útil, ubicación del error, acción de diagnóstico o reintento cuando sea seguro.
- **Unavailable:** proveedor desconectado, capacidad no soportada, dato sin verificar o integración incompleta; nunca simular disponibilidad.

## 9. Animaciones e interacciones

- Usar transiciones de **100-180 ms** para controles y **180-240 ms** para apertura/cierre de paneles cuando aporten orientación.
- Animar principalmente opacity y transform; evitar efectos que disparen layout costoso.
- El cambio de modo, actividad de agentes, apertura de archivos y aparición de resultados puede tener microinteracciones discretas.
- Evitar partículas, confeti y movimiento ambiental intenso. Se permite un desplazamiento sutil y lento de los degradados de fondo de OrderCode, siempre detrás del contenido y sin dificultar la lectura ni el trabajo.
- Respetar `prefers-reduced-motion`: reemplazar movimiento no esencial por cambios inmediatos de estado.
- Objetivo de fluidez: 60 FPS en hardware de referencia, incluyendo streaming, indexación y listas largas mediante virtualización.

Coreografiar transiciones de vista, selección lateral con resorte, menús con profundidad y escala sutil, opciones escalonadas, borde luminoso al enfocar el compositor y elevación de tarjetas. Mantener movimiento reducido del sistema y del ajuste local, también en JavaScript; la excepción ambiental es el desplazamiento muy lento y discreto de degradados de fondo.

Los selectores del compositor se abren al pasar el ratón (120 ms) y cierran con margen de 180 ms al salir; permiten cruzar desde el control al menú. También admiten clic, flechas, Enter, Tab, cierre con Escape y clic exterior. El hover nunca ejecuta acciones ni cambia modelo, modo o permisos. El menú activo se mantiene mientras el usuario escribe o navega dentro.

## 10. Atajos y accesibilidad

- Búsqueda/comandos: `Ctrl/Cmd + Shift + P` (o equivalente configurable).
- Abrir archivo: `Ctrl/Cmd + P`.
- Enfocar chat: `Ctrl/Cmd + L` cuando no entre en conflicto con el contexto activo.
- Terminal: `Ctrl/Cmd + J` cuando sea compatible.
- Atajos visibles en menús y adaptados a Windows/macOS; no interceptar atajos esenciales del editor.
- Navegación completa por teclado, orden de foco coherente y estados focus visibles.
- Iconos sin texto con nombres accesibles; regiones importantes con etiquetas adecuadas.
- Contraste objetivo WCAG AA para texto y elementos funcionales; no depender solo de color para transmitir estado.
- Tamaños compactos sin sacrificar operabilidad con escalado, teclado o necesidades de accesibilidad.

## 11. Primer uso y continuidad

Primer uso: **abrir proyecto -> seleccionar/conectar modelo -> conversar**. Las opciones avanzadas se descubren cuando hagan falta. Mantener estado de proyecto, sesión, paneles y archivos abiertos entre reinicios cuando corresponda, con recuperación visible y sin prometer continuidad falsa.

## 12. Antipatrones prohibidos

- Chat/composer desproporcionados que consumen la mayor parte de la pantalla sin necesidad.
- Plan, Build y Auto como tres botones grandes o pestañas siempre presentes.
- Release como cuarto modo principal.
- Sidebar, inspector, terminal y grafo abiertos simultáneamente de forma predeterminada.
- Ocho subagentes representados por tarjetas permanentes.
- Dashboards con KPIs decorativos, exceso de tarjetas y espacios vacíos artificiosos.
- Gradientes grandes, brillo neón generalizado, glassmorphism pesado o efectos continuos.
- Vistas de herramientas sin funcionalidad real o datos de muestra presentados como operativos.
- Resultados completos de terminal insertados repetidamente en el contexto del chat.
- Menús con duplicados y rutas confusas para una misma acción.
- Interfaces que solo funcionan con mouse o que pierden legibilidad al redimensionarse.

## 13. Criterios de aceptación de diseño

La interfaz solo puede considerarse terminada si cumple todas las condiciones aplicables:

- [ ] La aplicación abre con el chat como foco y sin paneles secundarios innecesarios.
- [ ] Nunito se aplica a la interfaz; editor y terminal usan fuente monoespaciada.
- [ ] Se respetan los tokens Ion Spectrum en tema oscuro y existe tema claro usable.
- [ ] La identidad del cubo se utiliza sin sustituciones no aprobadas.
- [ ] La iconografía, botones, barras y campo de mensaje son compactos, legibles y consistentes.
- [ ] **Modelo y Plan/Build/Auto son desplegables**, no grupos de botones.
- [ ] `Auto` de trabajo y `Auto` de permisos son visual y semánticamente distintos.
- [ ] Release Center no figura entre los modos principales.
- [ ] Se puede abrir/cerrar editor, diff, terminal, inspector y sidebar sin perder la conversación.
- [ ] Se puede consultar actividad y logs completos sin contaminar el chat con stdout extenso.
- [ ] Los ocho especialistas existen en Agents, pero solo los activos se muestran durante la ejecución.
- [ ] Las autorizaciones explican alcance y permiten una decisión contextual real.
- [ ] Toda acción visible está conectada a funcionalidad real o claramente marcada como no disponible.
- [ ] Los estados de ejecución y error proceden del runtime, no de temporizadores o animaciones simuladas.
- [ ] Streaming, logs grandes y paneles redimensionables no bloquean la experiencia.
- [ ] Se comprueba con teclado, zoom y Reduced Motion; contraste accesible.
- [ ] Se revisan capturas reales de ventanas estrechas, normales y amplias en tema oscuro y claro.
- [ ] Se verifican flujos completos: nuevo proyecto, seleccionar modelo, Plan, Build, Auto, aprobación, diff, terminal y recuperación de sesión.

## 14. Regla de implementación visual

Primero deben funcionar los flujos reales; después se pulen tipografía, densidad, espaciados, detalles de superficies y microinteracciones sobre componentes reutilizables. El diseño nunca justifica introducir mocks que parezcan funcionalidades terminadas.

**Definición de éxito:** abrir proyecto, elegir modelo y modo, escribir una instrucción, observar el trabajo de los agentes, revisar cambios y resultados, todo desde una interfaz sobria que no obliga a gestionar manualmente su complejidad.
