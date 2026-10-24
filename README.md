# OrderCode

OrderCode es una aplicación de escritorio para desarrollar software con agentes de IA mediante un harness propio. Ofrece modos **Plan**, **Build** y **Auto**, terminal integrada, editor, Git, selección de modelos y controles de permisos.

## Descargas

**[Ver los instaladores oficiales](https://github.com/MatiasDuport/OrderCode/releases/latest)**

| Sistema | Arquitectura | Archivo |
| --- | --- | --- |
| Windows 11 | x64 | `.msi` |
| macOS | Apple Silicon (M1+) | `.dmg` (arm64/aarch64) |
| macOS | Intel | `.dmg` (x64/x86_64) |
| Linux | x64 | `.AppImage` o `.deb` |
| Linux | ARM64 | `.AppImage` o `.deb` |

En macOS, abre el DMG y arrastra OrderCode a Aplicaciones. La firma y notarización de Apple requieren credenciales de Apple Developer en GitHub Actions; si faltan, Gatekeeper puede mostrar una advertencia.

En Linux, instala el `.deb` con el gestor de paquetes (Ubuntu/Debian), o ejecuta el AppImage:

```bash
chmod +x OrderCode*.AppImage
./OrderCode*.AppImage
```

Linux requiere WebKitGTK 4.1 y otras librerías de escritorio. El `.deb` resuelve las dependencias mediante el gestor de paquetes. Para recibir actualizaciones integradas en Linux, utiliza **AppImage**; los usuarios de `.deb` deberán instalar una versión posterior manualmente.

## Primer uso

1. Instala OrderCode para tu sistema y CPU.
2. Abre una carpeta de proyecto.
3. Conecta un proveedor en **Ajustes → Modelos**.
4. Selecciona **Plan**, **Build** o **Auto** y describe tu objetivo.

Las actualizaciones se comprueban en **Ajustes → Actualizaciones**. Los paquetes del actualizador se verifican mediante firma criptográfica antes de instalarse. Las firmas de actualización no sustituyen la firma y notarización de Apple.

## Desarrollo

Se requiere Node.js 24+, pnpm 11, Rust estable y, para Linux, las dependencias de desarrollo de Tauri 2. La compilación utiliza Node incluido en la aplicación instalada, por lo que no es necesario que los usuarios finales instalen Node globalmente.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @ordercode/desktop tauri:dev
```

Para producir paquetes locales ejecuta `pnpm exec tauri build --bundles dmg` en macOS, `--bundles appimage,deb` en Linux o `--bundles msi` en Windows desde `apps/desktop`.

## Publicación

El workflow `.github/workflows/release.yml` compila paquetes nativos para cinco objetivos: Windows x64, macOS ARM64, macOS Intel, Linux x64 y Linux ARM64. Solo publica el release cuando están presentes los paquetes, firmas y manifiesto de actualización por plataforma. Requiere el secret `TAURI_SIGNING_PRIVATE_KEY` (y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` si corresponde). Para evitar advertencias de Gatekeeper, configura además los secrets de certificado/notarización Apple indicados en el workflow.

Para una nueva versión actualiza coordinadamente los números de versión en el monorepo y publica el tag `vX.Y.Z`.

## Documentación

La especificación de producto está en `SDD.md`, la interfaz en `DESIGN.md` y las reglas de trabajo en `AGENTS.md`.

Licencia [Apache-2.0](LICENSE).
