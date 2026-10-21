
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
- **Degradados Ion Spectrum:** usar verde → azul → violeta en bordes, selección, controles primarios y títulos puntuales. El fondo utiliza iluminación difusa de baja saturación junto a los bordes, con tres focos amplios que se desplazan en ciclos independientes. Mantener el centro de lectura limpio, sin ondas, trazos ni figuras decorativas. Durante la conversación y los ajustes la iluminación es aún más discreta. El compositor tiene superficie opaca y borde de espectro; el tema claro conserva tonos oscuros en el texto.
- **Regla de contención:** no más de uno o dos acentos visuales intensos simultáneos en la vista principal.
- Sin neón generalizado, brillos permanentes, transparencias costosas ni efectos de cristal aplicados por defecto a todos los paneles.

## 3. Tokens de densidad y componentes

Estas dimensiones son **objetivos de referencia**, no límites rígidos; adaptarlas por plataforma, escalado y accesibilidad.

| Elemento | Objetivo compacto |
|---|---|
| Iconografía habitual | 14-16 px, consistente |
| Controles de barra / menús | 30-32 px de alto |
| Área interactiva de iconos | Aproximadamente 28-32 px; ampliar según accesibilidad |
| Barra superior | 38 px |
| Navegación | 196 px con nombres visibles; barra inferior en móvil |
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

Mostrar el isotipo transparente de OrderCode, sin texto ni fondo, Buscar y los controles de ventana. Mostrar el acceso a actualizaciones únicamente cuando haya una disponible, una descarga o un error; la búsqueda manual permanece en Ajustes. El proyecto se selecciona en Workspace; su nombre aparece en el encabezado de conversación. Evitar duplicar aquí el selector de modelo, el esfuerzo, el modo o los permisos del composer.

### 4.2. Navegación lateral

- Navegación con nombres siempre visibles: Conversación, Proyecto e Historial. Botón Nueva conversación al inicio; Ajustes al final.
- Herramientas muestra cuatro accesos cotidianos: Cambios, Vista previa, Terminal y Agentes. Avanzado agrupa Extensiones, Mapa del código, Uso y actividad y Publicar proyecto. Ambos grupos se despliegan por clic o teclado; las funciones avanzadas se abren automáticamente cuando son la vista activa. Evitar duplicar destinos o mostrar todos los controles técnicos de entrada.
- Cada herramienta presenta una tarea clara. Cambios muestra una comparación a la vez y despliega ramas, sincronización e historial bajo demanda. Vista previa se abre desde el chat en un panel contextual junto a la conversación, conserva su dirección y pestaña al cerrarse dentro del mismo proyecto, pausa el contenido web mientras está oculta, y separa Web de Imágenes y gráficas; descubre archivos solo al abrir estas últimas. Agentes prioriza selección y creación; transferencias y borrador por descripción son opcionales. Extensiones diferencia Instrucciones (Skills) y Conexiones (MCP), con el catálogo bajo demanda. Uso evita encabezados duplicados y despliega filtros secundarios. Publicar proyecto conserva su módulo independiente y separa versiones de sitios web. Sin proyecto, explicar el siguiente paso y ofrecer Abrir proyecto.
- Conversación muestra el chat; Proyecto abre o cierra los archivos sin perder la conversación. El panel se cierra desde su control, con Escape o al pulsar fuera en ventanas estrechas.
- Ancho de referencia 196 px; 174 px en ventanas medianas. En móvil, navegación inferior con etiquetas y herramientas en un desplegable.
- Ajustes tiene General, Modelos, Seguridad y Actualizaciones; Uso, Conexión local, Editor, Accesibilidad y Datos se agrupan en Avanzado. Las conexiones aparecen antes que la personalización del catálogo.

### 4.3. Área central

- Conversación como vista predeterminada, con ancho de lectura contenido para que las líneas no sean excesivas.
- Editor o diff junto al chat **únicamente** cuando el usuario lo abra o una tarea requiera revisión visible.
- La división entre chat y editor es ajustable; permitir maximizar temporalmente cualquiera.
- No reservar espacio vacío para un inspector que no está en uso.

### 4.4. Panel contextual derecho

Oculto por defecto. Aparece para archivos, cambios, actividad de agentes, detalles de ejecución, contexto, uso o autorizaciones. Solo un contexto principal a la vez. Debe cerrarse y recordarse su estado sin interferir con la conversación.

### 4.5. Panel inferior

Oculto por defecto; incluye Terminal, Processes, Logs y Problems como vistas alternables. Tamaño ajustable y botón de cierre en la cabecera; cerrar el panel lo oculta sin terminar shells activos. Cada sesión se cierra desde su pestaña. No transmitir todo el stdout del agente al chat.

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

Mostrar Modelo, Esfuerzo, Modo (Auto inicialmente) y Permisos en una barra común compacta, con iconos discretos y sin recuadros independientes en cada control. El modelo destaca suavemente; los demás conservan etiqueta y valor para distinguir sus opciones Auto. Esfuerzo tiene un selector propio y visible, ofrece Auto y únicamente los niveles admitidos por el modelo; sin niveles configurables explica por qué. Permisos muestra el perfil actual. No presentar niveles de esfuerzo que el modelo no admite. La barra se adapta al ancho real del chat, en dos filas cuando es necesario. Continuo conserva un botón propio con indicador de activación y ayuda sobre trabajar hasta completar la tarea. Retirar barras de estado técnicas y el selector flotante de tema; la apariencia se cambia en Ajustes.

El campo de mensaje permanecerá accesible en la parte inferior del chat. El borrador se conserva en memoria al visitar herramientas o Ajustes, por conversación; al abrir el primer proyecto se traslada a esa conversación. No guardar estos borradores entre los ajustes de usuario.

- Altura inicial mínima, adaptada al texto; crecimiento limitado y scroll interno cuando sea necesario.
- Elementos indispensables: entrada, adjuntar/referenciar, **selector de modelo**, **selector de modo**, acceso a permisos y enviar/detener.
- Los controles secundarios se agrupan en un menú de más acciones cuando falta espacio.
- No introducir grandes paneles explicativos dentro del composer.
- Botón enviar solo si hay contenido válido; durante ejecución, acceso inequívoco a detener.
- El botón **Continuo** (trabajar hasta completar) se activa para una tarea y muestra su estado real al navegar entre vistas. Los ajustes de ejecución quedan bloqueados durante la tarea; detener y resolver autorizaciones siguen disponibles.
- Los comandos `/` y el panel de especialistas se abren bajo demanda en menús ajustados a la ventana, con cierre accesible incluso en pantallas pequeñas. Los comandos de consulta funcionan sin conectar un modelo; mostrar el contexto de la sesión que los solicitó.

### 5.3. Selector de modelo

**Un desplegable, no un conjunto de botones permanentes.** Debe mostrar el modelo activo de forma abreviada e incluir búsqueda, recientes, favoritos, proveedor, capacidad relevante, disponibilidad y distinción Free/paid/local.

- Precio, límites y privacidad se consultan en detalle, no ocupan permanentemente la barra.
- Filtro **Free Only** visible dentro del selector o de sus opciones.
- Cuando el modelo no está configurado, ofrecer una acción clara para conectarlo.
- Los subagentes heredan el modelo de la conversación: no mostrar selectores por agente.
- Los cambios no deben ocultar operaciones ya iniciadas ni sus parámetros reales.
- El desplegable mantiene búsqueda y filtros fijos, un único catálogo desplazable y pie de gestión. Ofrece Recomendados (selección breve de modelos disponibles), Favoritos y Catálogo; OpenRouter se agrupa por creador al explorar y abrevia nombres sin repetirlo. Cada fila distingue Gratis, Tu plan, Local o API e indica razonamiento cuando esté disponible. Ajustes permite explorar por proveedor y guardar favoritos sin cambiar el modelo de la conversación; los precios y niveles de esfuerzo completos se consultan en el detalle de cada fila.

### 5.4. Selector de modo

**Un único desplegable compacto**, nunca tres botones o pestañas permanentes:

- `Plan`: investigar y planificar sin editar código por defecto.
- `Build`: implementar y verificar.
- `Auto`: decidir dinámicamente cuándo explorar, planificar, implementar y verificar.

El valor elegido es visible en reposo. Cuando `Auto` está trabajando, una indicación discreta puede informar la fase interna actual.

**No confundir:** el esfuerzo `Auto`, el modo de trabajo `Auto` y el permiso `Auto` son ajustes independientes. Cada selector muestra su etiqueta y su valor; el perfil elegido permanece visible en Permisos.

**Release no es un cuarto modo**; se accede al Release Center desde Git o el resultado de una tarea.

### 5.5. Aprobaciones

Insertar una solicitud contextual, pequeña y clara: acción, recurso afectado, riesgo y opciones para rechazar, permitir una vez, permitir durante la sesión o crear una regla limitada. No ocultar la autorización crítica en un toast efímero.

## 6. Subagentes y orquestación

Agentes oficiales: **General, Explore, Architect, Build, Debug, QA, Security y Review**.

- Mostrar solo los agentes que están actuando; no ocho tarjetas permanentes.
- Cada subagente activo presenta nombre, tarea, estado y nivel; sus herramientas y resultados se agrupan e indentan en la actividad desplegable del chat.
- Las delegaciones paralelas se agrupan bajo la misma tarea y pueden desplegarse individualmente.
- Los resultados aparecen como síntesis con enlaces a evidencias, no como conversaciones internas duplicadas.
- `Agents` permite consultar, crear, editar, activar, desactivar, importar y probar configuraciones sin configurar modelos diferentes para cada uno.
- El editor usa una vista propia con pasos Objetivo, Capacidades, Colaboración y Revisar, navegación y acciones persistentes. Agrupar y buscar herramientas, distinguir lectura de efectos que modifican recursos, confirmar reemplazos de plantilla y cierre con cambios pendientes. Guardar cambios de un agente activo conserva su estado y la selección actual.
- Los estados deben distinguir running, waiting approval, paused, failed, cancelled y completed.

## 7. Superficies de trabajo secundarias

### 7.1. Workspace y Sessions

Apertura de carpeta/repositorio, proyectos recientes, cambio de proyecto y sesiones por proyecto. El usuario debe volver al chat del proyecto en una acción. Búsqueda, reciente y favorito sustituyen listados gigantes.

El explorador Workspace usa un panel de 248 px, cabecera compacta, proyecto en dos líneas y búsqueda sin atajos decorativos. Mostrar carpetas plegables antes que archivos, nombres base con rutas completas en tooltip, iconos discretos por tipo y selección con acento azul. Cargar el contenido de cada carpeta al expandirla; ocultar por defecto carpetas auxiliares y ocultas, con un filtro explícito para revelarlas. La búsqueda conserva los antecesores de cada resultado. Ofrecer actualizar y contraer carpetas, navegación por teclado y estados de carga/error. Git ocupa una sola fila fija con rama y resumen de cambios; nunca presentar el estado bruto de Git en el panel. Mantener estos patrones en claro, oscuro y movimiento reducido.

### 7.2. Editor y diffs

Editor real con pestañas, explorador opcional, navegación de símbolos y diagnósticos. Abrir archivos citados desde el chat. Vista de diff clara con archivos y líneas afectadas, agrupada por ejecución. No mostrar controles para revertir cuando la reversión no sea segura o esté disponible.

Las imágenes raster se muestran como vista previa con ajuste, zoom, dimensiones y tamaño, sin controles de edición de texto. Los archivos binarios y los que superan el límite de vista previa muestran un estado explícito de solo lectura. La vista Web admite páginas HTTPS y servidores locales mediante un marco aislado. La vista Gráficas reúne archivos PNG, JPEG, GIF, WebP, AVIF, BMP, SVG y HTML del proyecto, priorizando resultados recientes de tareas. El HTML se muestra en un marco aislado y estático; se bloquean scripts y recursos externos. Para vistas interactivas se abre el servidor local del proyecto en la pestaña Web. La lectura manual del explorador permanece en la interfaz nativa y no se incorpora al contexto del modelo. Al abrir un archivo, el editor o visor ocupa el panel completo sin un bloque vacío de cambios encima. En la conversación, cada invocación de herramienta tiene una sola fila que combina inicio y resultado; su estado es independiente del estado de la ejecución y la actividad terminada comienza contraída.

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

Coreografiar transiciones de vista, selección lateral con resorte, pasos iniciales escalonados, menús con profundidad y escala sutil, barrido de luz al pasar por la acción principal y borde orbital al enfocar el compositor o durante una ejecución real. La iluminación de fondo se anima mediante transform y opacity; no usar bucles de JavaScript por fotograma. Pausar animaciones al ocultar la ventana. Conservar movimiento reducido del sistema y del ajuste local, también en JavaScript: la identidad cromática permanece estática y los controles cambian de estado de inmediato.

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

Inicio guiado por dos pasos: Tu proyecto (Abrir carpeta) y Tu asistente (Conectar modelo). Reflejar el estado real de cada paso y retirarlos al completar ambos. Usar textos cotidianos, sin exigir entender proveedores, runtime o perfiles antes de empezar. Nueva conversación conserva el proyecto y la configuración; respeta ejecuciones activas y cambios sin guardar.

Primer uso: **abrir proyecto -> seleccionar/conectar modelo -> conversar**. Las opciones avanzadas se descubren cuando hagan falta. Mantener estado de proyecto, sesión, paneles y archivos abiertos entre reinicios cuando corresponda, con recuperación visible y sin prometer continuidad falsa.

## 12. Antipatrones prohibidos

- Navegación que exige adivinar iconos, controles duplicados o información técnica permanente.
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
