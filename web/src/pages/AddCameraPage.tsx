import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { readSession } from "../auth/storage";
import { DashChrome } from "../components/DashChrome";
import { statusLabel } from "../data/assets";
import {
  addCamera,
  isCameraEnabled,
  setCameraEnabled,
  useAssets,
  useCameras,
} from "../data/cameraStore";
import "./dashboard.css";

export function AddCameraPage() {
  const session = readSession();
  const navigate = useNavigate();
  const assets = useAssets();
  const cameras = useCameras();

  const zoneAssets = useMemo(
    () => assets.filter((asset) => asset.id !== "asset-all"),
    [assets],
  );

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [location, setLocation] = useState("");
  const [stream, setStream] = useState("");
  const [assetId, setAssetId] = useState("");
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!assetId && zoneAssets[0]) setAssetId(zoneAssets[0].id);
  }, [assetId, zoneAssets]);

  if (!session) return <Navigate to="/login" replace />;

  const nextCodeHint = `CAM-${String(cameras.length + 1).padStart(2, "0")}`;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      addCamera({
        name,
        code: code.trim() || nextCodeHint,
        location,
        stream,
        assetId,
      });
      setName("");
      setCode("");
      setLocation("");
      setStream("");
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось добавить камеру");
    } finally {
      setPending(false);
    }
  };

  const onToggleCamera = (id: string, enabled: boolean) => {
    setListError("");
    try {
      setCameraEnabled(id, enabled);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Не удалось изменить камеру");
    }
  };

  return (
    <main className="dash">
      <DashChrome session={session} kicker="Управление" title="Камеры" />

      <section className="dashAdd">
        <div className="dashAddPanel">
          <div className="dashAddIntro">
            <div className="dashSideEyebrow">Камеры</div>
            <h2 className="dashAddTitle">Добавление камеры</h2>
            <p className="dashAddText">
              Укажите параметры источника и зону актива. Камера появится в сетке мониторинга сразу после
              сохранения.
            </p>
          </div>

          <form className="dashAddForm" onSubmit={onSubmit}>
            <label className="dashField">
              <span>Название</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="КПП · въезд"
                spellCheck={false}
                autoFocus
              />
            </label>

            <div className="dashFieldRow">
              <label className="dashField">
                <span>Код</span>
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder={nextCodeHint}
                  spellCheck={false}
                />
              </label>

              <label className="dashField">
                <span>Расположение</span>
                <input
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="Периметр"
                  spellCheck={false}
                />
              </label>
            </div>

            <label className="dashField">
              <span>Поток</span>
              <input
                value={stream}
                onChange={(event) => setStream(event.target.value)}
                placeholder="rtsp://192.168.0.10:554/stream1"
                spellCheck={false}
              />
            </label>

            <label className="dashField">
              <span>Актив / зона</span>
              <select value={assetId} onChange={(event) => setAssetId(event.target.value)}>
                {zoneAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>

            {error ? <div className="dashFormError">{error}</div> : null}

            <div className="dashAddActions">
              <button className="dashGhost" type="button" onClick={() => navigate("/")}>
                К мониторингу
              </button>
              <button className="dashPrimary" type="submit" disabled={pending}>
                {pending ? "Сохранение…" : "Добавить камеру"}
              </button>
            </div>
          </form>
        </div>

        <aside className="dashAddAside">
          <div className="dashAddPreview">
            <div className="dashSideEyebrow">Превью</div>
            <article className="cameraTile cameraTile--online">
              <div className="cameraTileFeed" aria-hidden>
                <div className="cameraTileNoise" />
                <div className="cameraTileMark">NO SIGNAL</div>
              </div>
              <footer className="cameraTileMeta">
                <div>
                  <div className="cameraTileName">{name.trim() || "Новая камера"}</div>
                  <div className="cameraTileCode">
                    {(code.trim() || nextCodeHint).toUpperCase()} · {location.trim() || "Зона"}
                  </div>
                  <div className="cameraTileStream">{stream.trim() || "Поток не указан"}</div>
                </div>
                <span className="cameraTileStatus cameraTileStatus--online">
                  <i aria-hidden />
                  {statusLabel.online}
                </span>
              </footer>
            </article>
          </div>

          <div className="dashCameraManage">
            <div className="dashCameraManageHead">
              <div className="dashSideEyebrow">Список</div>
              <strong>{String(cameras.length).padStart(2, "0")}</strong>
            </div>

            {listError ? <div className="dashFormError">{listError}</div> : null}

            <ul className="dashCameraManageList">
              {cameras.map((camera) => {
                const enabled = isCameraEnabled(camera);
                return (
                  <li key={camera.id} className={`dashCameraManageItem${enabled ? "" : " is-disabled"}`}>
                    <div className="dashCameraManageMain">
                      <div className="dashCameraManageName">{camera.name}</div>
                      <div className="dashCameraManageMeta">
                        {camera.code} · {camera.location}
                        {camera.stream ? ` · ${camera.stream}` : ""}
                      </div>
                    </div>
                    <span className={`cameraTileStatus cameraTileStatus--${camera.status}`}>
                      <i aria-hidden />
                      {enabled ? statusLabel[camera.status] : "Off"}
                    </span>
                    <button
                      type="button"
                      className={enabled ? "dashCameraDisable" : "dashCameraEnable"}
                      onClick={() => onToggleCamera(camera.id, !enabled)}
                    >
                      {enabled ? "Отключить" : "Включить"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>
      </section>
    </main>
  );
}
