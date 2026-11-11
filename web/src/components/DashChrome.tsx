import { NavLink } from "react-router-dom";
import { writeSession, type Session } from "../auth/storage";
import { EyeLogo } from "./EyeLogo";
import "../pages/dashboard.css";

const NAV_ITEMS = [
  { to: "/", label: "Мониторинг", end: true },
  { to: "/cameras/new", label: "Камеры", end: false },
] as const;

type DashChromeProps = {
  session: Session;
  kicker: string;
  title: string;
};

export function DashChrome({ session, kicker, title }: DashChromeProps) {
  return (
    <header className="dashChrome">
      <div className="dashBrand">
        <EyeLogo to="/" size="sm" />
        <div className="dashBrandMeta">
          <div className="dashKicker">{kicker}</div>
          <div className="dashTitle">{title}</div>
        </div>
      </div>

      <nav className="dashNav" aria-label="Разделы">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `dashNavLink${isActive ? " is-active" : ""}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="dashChromeRight">
        <div className="dashAccount">
          <div className="dashAccountAvatar" aria-hidden>
            {(session.name.trim().slice(0, 1) || session.login.slice(0, 1) || "?").toUpperCase()}
          </div>
          <div className="dashAccountMeta">
            <span className="dashAccountName">{session.name}</span>
            <span className="dashAccountLogin">@{session.login}</span>
          </div>
          <button
            className="dashLogout"
            type="button"
            onClick={() => {
              writeSession(null);
              window.location.assign("/login");
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <path
                d="M10 5H6.8C5.8 5 5 5.8 5 6.8v10.4C5 18.2 5.8 19 6.8 19H10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path
                d="M10 12h9m0 0-3.2-3.2M19 12l-3.2 3.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Выйти
          </button>
        </div>
      </div>
    </header>
  );
}
