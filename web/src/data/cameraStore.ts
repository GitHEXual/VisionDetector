import { useSyncExternalStore } from "react";
import {
  assets as seedAssets,
  cameras as seedCameras,
  type Asset,
  type Camera,
} from "./assets";

type CameraDraft = {
  name: string;
  code: string;
  location: string;
  stream: string;
  assetId: string;
};

let camerasState: Camera[] = seedCameras.map((camera) => ({ ...camera }));
let assetsState: Asset[] = seedAssets.map((asset) => ({
  ...asset,
  cameraIds: [...asset.cameraIds],
}));

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getCamerasSnapshot() {
  return camerasState;
}

function getAssetsSnapshot() {
  return assetsState;
}

export function useCameras() {
  return useSyncExternalStore(subscribe, getCamerasSnapshot, getCamerasSnapshot);
}

export function useAssets() {
  return useSyncExternalStore(subscribe, getAssetsSnapshot, getAssetsSnapshot);
}

export function cameraById(id: string) {
  return camerasState.find((camera) => camera.id === id);
}

export function addCamera(draft: CameraDraft) {
  const name = draft.name.trim();
  const code = draft.code.trim().toUpperCase();
  const location = draft.location.trim();
  const stream = draft.stream.trim();
  const assetId = draft.assetId;

  if (name.length < 2) throw new Error("Укажите название камеры");
  if (!/^[A-Z0-9-]{3,16}$/.test(code)) {
    throw new Error("Код: 3–16 символов, латиница, цифры и -");
  }
  if (location.length < 2) throw new Error("Укажите расположение");
  if (stream.length < 4) throw new Error("Укажите поток камеры");
  if (camerasState.some((camera) => camera.code === code)) {
    throw new Error("Камера с таким кодом уже есть");
  }

  const targetAsset = assetsState.find((asset) => asset.id === assetId);
  if (!targetAsset) throw new Error("Выберите актив");

  const id = `cam-${Date.now().toString(36)}`;
  const camera: Camera = {
    id,
    name,
    code,
    location,
    stream,
    status: "online",
    enabled: true,
  };

  camerasState = [...camerasState, camera];
  assetsState = assetsState.map((asset) => {
    if (asset.id === "asset-all" || asset.id === assetId) {
      return { ...asset, cameraIds: [...asset.cameraIds, id] };
    }
    return asset;
  });
  emit();
  return camera;
}

export function setCameraEnabled(id: string, enabled: boolean) {
  const camera = camerasState.find((item) => item.id === id);
  if (!camera) throw new Error("Камера не найдена");

  camerasState = camerasState.map((item) => {
    if (item.id !== id) return item;
    if (enabled) {
      return {
        ...item,
        enabled: true,
        status: item.status === "offline" ? "online" : item.status,
      };
    }
    return {
      ...item,
      enabled: false,
      status: "offline",
    };
  });
  emit();
}

export function isCameraEnabled(camera: Camera) {
  return camera.enabled !== false;
}
