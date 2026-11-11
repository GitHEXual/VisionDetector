import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ensureDemoAccount, loginAccount, readSession, registerAccount } from "../auth/storage";
import { EyeLogo } from "../components/EyeLogo";
import "./auth.css";

type Mode = "login" | "register";

const LOGIN = /^[a-zA-Z0-9._-]{3,32}$/;

export function AuthPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const session = readSession();
  const [name, setName] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setName("");
    setLogin("");
    setPassword("");
    setConfirm("");
    setError("");
    void ensureDemoAccount();
  }, [mode]);

  if (session) return <Navigate to="/" replace />;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const cleanLogin = login.trim();
    if (!LOGIN.test(cleanLogin)) {
      setError("Логин: 3–32 символа, латиница, цифры, . _ -");
      return;
    }
    if (password.length < 4) {
      setError("Пароль должен быть не короче 4 символов");
      return;
    }
    if (mode === "register") {
      if (name.trim().length < 2) {
        setError("Укажите имя");
        return;
      }
      if (password !== confirm) {
        setError("Пароли не совпадают");
        return;
      }
    }

    setPending(true);
    try {
      if (mode === "register") await registerAccount(name, cleanLogin, password);
      else await loginAccount(cleanLogin, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось выполнить запрос");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="shell">
      <header className="chrome">
        <div />
        <div>{mode === "login" ? "Вход" : "Регистрация"}</div>
      </header>

      <section className="stage">
        <div className="copy">
          <EyeLogo to={mode === "login" ? "/login" : "/register"} />
          <div className="kicker">{mode === "login" ? "Доступ" : "Новый аккаунт"}</div>
          <h1 className="title">
            {mode === "login" ? (
              <>
                Войдите
                <br />в <em>систему</em>
              </>
            ) : (
              <>
                Создайте
                <br />
                <em>аккаунт</em>
              </>
            )}
          </h1>
          <p className="lead">
            {mode === "login"
              ? "Логин и пароль открывают кабинет. Учётные записи хранятся только в этом браузере."
              : "Имя, логин и пароль. После регистрации вы сразу попадёте в кабинет."}
          </p>
        </div>

        <div className="panel">
          <nav className="tabs">
            <Link to="/login" className={mode === "login" ? "active" : undefined}>
              Вход
            </Link>
            <Link to="/register" className={mode === "register" ? "active" : undefined}>
              Регистрация
            </Link>
          </nav>

          <form className="form" onSubmit={onSubmit} noValidate>
            {mode === "register" && (
              <label className="field">
                <span>Имя</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  placeholder="Как к вам обращаться"
                />
              </label>
            )}
            <label className="field">
              <span>Логин</span>
              <input
                type="text"
                value={login}
                onChange={(event) => setLogin(event.target.value)}
                autoComplete="username"
                placeholder="username"
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>Пароль</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder="Не короче 4 символов"
              />
            </label>
            {mode === "register" && (
              <label className="field">
                <span>Повтор пароля</span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="new-password"
                  placeholder="Ещё раз"
                />
              </label>
            )}
            {error && <p className="error">{error}</p>}
            <button className="submit" type="submit" disabled={pending}>
              {pending ? "Секунду…" : mode === "login" ? "Войти" : "Зарегистрироваться"}
            </button>
            <p className="switch">
              {mode === "login" ? (
                <>
                  Нет аккаунта? <Link to="/register">Регистрация</Link>
                </>
              ) : (
                <>
                  Уже есть аккаунт? <Link to="/login">Войти</Link>
                </>
              )}
            </p>
          </form>
        </div>
      </section>
    </main>
  );
}
