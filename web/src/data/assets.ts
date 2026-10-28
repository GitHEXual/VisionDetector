export type CameraStatus = "online" | "offline" | "alarm";

export type Camera = {
  id: string;
  name: string;
  code: string;
  status: CameraStatus;
  location: string;
};

export type Asset = {
  id: string;
  name: string;
  kind: "site" | "zone";
  cameraIds: string[];
};

export const cameras: Camera[] = [
  { id: "cam-01", name: "КПП · въезд", code: "CAM-01", status: "online", location: "Периметр" },
  { id: "cam-02", name: "Парковка A", code: "CAM-02", status: "online", location: "Двор" },
  { id: "cam-03", name: "Склад · ворота", code: "CAM-03", status: "alarm", location: "Склад" },
  { id: "cam-04", name: "Ресепшен", code: "CAM-04", status: "online", location: "Холл" },
  { id: "cam-05", name: "Коридор 2 этаж", code: "CAM-05", status: "offline", location: "Офис" },
  { id: "cam-06", name: "Серверная", code: "CAM-06", status: "online", location: "Техзона" },
  { id: "cam-07", name: "Двор · север", code: "CAM-07", status: "online", location: "Периметр" },
  { id: "cam-08", name: "Пандус", code: "CAM-08", status: "offline", location: "Склад" },
  { id: "cam-09", name: "Лифт · холл", code: "CAM-09", status: "online", location: "Холл" },
  { id: "cam-10", name: "Крыша · антенна", code: "CAM-10", status: "online", location: "Периметр" },
  { id: "cam-11", name: "Касса", code: "CAM-11", status: "alarm", location: "Торговый зал" },
  { id: "cam-12", name: "Запасной выход", code: "CAM-12", status: "online", location: "Офис" },
];

export const assets: Asset[] = [
  {
    id: "asset-all",
    name: "Все камеры",
    kind: "site",
    cameraIds: cameras.map((camera) => camera.id),
  },
  {
    id: "asset-perimeter",
    name: "Периметр",
    kind: "zone",
    cameraIds: ["cam-01", "cam-07", "cam-10"],
  },
  {
    id: "asset-yard",
    name: "Двор и парковка",
    kind: "zone",
    cameraIds: ["cam-02", "cam-07"],
  },
  {
    id: "asset-warehouse",
    name: "Склад",
    kind: "zone",
    cameraIds: ["cam-03", "cam-08"],
  },
  {
    id: "asset-office",
    name: "Офис",
    kind: "zone",
    cameraIds: ["cam-04", "cam-05", "cam-09", "cam-12"],
  },
  {
    id: "asset-tech",
    name: "Техзона",
    kind: "zone",
    cameraIds: ["cam-06"],
  },
  {
    id: "asset-retail",
    name: "Торговый зал",
    kind: "zone",
    cameraIds: ["cam-11"],
  },
];

export function cameraById(id: string) {
  return cameras.find((camera) => camera.id === id);
}

export const statusLabel: Record<CameraStatus, string> = {
  online: "Online",
  offline: "Offline",
  alarm: "Alarm",
};
