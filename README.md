<p align="center">
  <img src="brand/LogoSinFondo.png" alt="OrderCode" width="112" />
</p>

<h1 align="center">OrderCode</h1>

<p align="center">Un harness de escritorio para planificar, desarrollar y verificar software con agentes de IA.</p>

<p align="center">
  <a href="https://github.com/MatiasDuport/OrderCode/releases/latest">
    <img src="https://img.shields.io/badge/Descargar-Windows%20x64-83aaff?style=for-the-badge&logo=windows&logoColor=white" alt="Descargar para Windows x64" />
  </a>
  <a href="https://github.com/MatiasDuport/OrderCode/releases/latest">
    <img src="https://img.shields.io/github/v/release/MatiasDuport/OrderCode?display_name=tag&style=for-the-badge&label=LATEST" alt="Última versión" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/MatiasDuport/OrderCode?style=for-the-badge" alt="Licencia Apache-2.0" />
  </a>
</p>

<p align="center"><strong>Plan</strong> antes de cambiar · <strong>Build</strong> para implementar · <strong>Auto</strong> para delegar el flujo</p>

---

## Empieza en minutos

1. [Descarga OrderCode para Windows x64](https://github.com/MatiasDuport/OrderCode/releases/latest).
2. Abre el instalador `.msi` y sigue los pasos.
3. Abre OrderCode y elige una carpeta de proyecto.
4. Conecta un proveedor de modelos en **Ajustes → Modelos** o elige uno disponible.
5. Escribe lo que quieres hacer y selecciona **Plan**, **Build** o **Auto**.

> ¿Ya tienes OrderCode instalado? Busca e instala nuevas versiones en **Ajustes → Actualizaciones**.

## Un espacio de trabajo para todo el cambio

| Planifica | Implementa | Verifica |
| --- | --- | --- |
| Define el objetivo y revisa el plan antes de modificar el proyecto. | Trabaja con el proyecto, el terminal y las herramientas locales desde la conversación. | Inspecciona los cambios, consulta el grafo del código y visualiza páginas o gráficas. |

- **Modelos a tu medida:** selector enfocado en modelos de programación, filtros por proveedor y niveles de razonamiento solo cuando el modelo los admite.
- **Control explícito:** elige cómo trabaja OrderCode y qué permisos puede usar en tu proyecto.
- **Continuidad local:** conserva conversaciones, eventos y preferencias en el dispositivo.
- **Actualizaciones verificadas:** OrderCode comprueba la firma del instalador antes de instalar una actualización.

## Descargas

La publicación más reciente contiene el instalador para Windows x64, su firma y los metadatos del actualizador.

<p align="center">
  <a href="https://github.com/MatiasDuport/OrderCode/releases/latest">
    <img src="https://img.shields.io/badge/Ver%20descarga%20e%20instrucciones-83aaff?style=for-the-badge&logo=github&logoColor=white" alt="Abrir descargas de OrderCode" />
  </a>
</p>

## Proyecto abierto

OrderCode se distribuye bajo la licencia [Apache-2.0](LICENSE). El código fuente y las versiones publicadas están disponibles en este repositorio.

<details>
  <summary>Compilar desde el código fuente</summary>

  Requisitos: Node.js, pnpm y Rust estable.

  ```powershell
  pnpm install --frozen-lockfile
  pnpm --filter @ordercode/desktop tauri:dev
  ```

  Para generar los paquetes de producción:

  ```powershell
  pnpm build
  ```
</details>

<p align="center"><sub>OrderCode · Apache-2.0 · Windows x64</sub></p>
