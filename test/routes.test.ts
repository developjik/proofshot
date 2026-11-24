import { describe, expect, it } from "vitest";
import {
  discoverRouterRoutes,
  inferRoutes,
  nextAppRoute,
  nextPagesRoute,
  parseRouterSource,
  staticHtmlRoute,
} from "../src/routes";

const routesOf = (files: string[]) =>
  inferRoutes(files).map((candidate) => candidate.route);

describe("Next.js App Router", () => {
  it("maps page files to routes", () => {
    expect(nextAppRoute("app/page.tsx")).toEqual({
      route: "/",
      reason: "Next.js App Router page app/page.tsx",
    });
    expect(nextAppRoute("src/app/dashboard/page.tsx")?.route).toBe(
      "/dashboard",
    );
    expect(nextAppRoute("src/app/settings/billing/page.tsx")?.route).toBe(
      "/settings/billing",
    );
  });

  it("drops route groups and keeps dynamic segments", () => {
    expect(nextAppRoute("src/app/(marketing)/pricing/page.tsx")?.route).toBe(
      "/pricing",
    );
    expect(nextAppRoute("src/app/blog/[slug]/page.tsx")?.route).toBe(
      "/blog/[slug]",
    );
    expect(inferRoutes(["src/app/blog/[slug]/page.tsx"])[0]?.dynamic).toBe(
      true,
    );
  });

  it("ignores non-page files", () => {
    expect(nextAppRoute("src/app/layout.tsx")).toBeNull();
    expect(nextAppRoute("src/app/loading.tsx")).toBeNull();
    expect(nextAppRoute("src/app/api/hello/route.ts")).toBeNull();
    expect(nextAppRoute("src/app/styles.css")).toBeNull();
  });
});

describe("Next.js Pages Router", () => {
  it("maps index, nested and dynamic pages", () => {
    expect(nextPagesRoute("pages/index.tsx")?.route).toBe("/");
    expect(nextPagesRoute("pages/about.tsx")?.route).toBe("/about");
    expect(nextPagesRoute("pages/blog/index.tsx")?.route).toBe("/blog");
    expect(nextPagesRoute("src/pages/blog/[slug].tsx")?.route).toBe(
      "/blog/[slug]",
    );
  });

  it("ignores app shell files and API routes", () => {
    expect(nextPagesRoute("pages/_app.tsx")).toBeNull();
    expect(nextPagesRoute("pages/_document.tsx")).toBeNull();
    expect(nextPagesRoute("pages/404.tsx")).toBeNull();
    expect(nextPagesRoute("pages/api/users.ts")).toBeNull();
  });
});

describe("static HTML", () => {
  it("maps index and named pages", () => {
    expect(staticHtmlRoute("index.html")).toBe("/");
    expect(staticHtmlRoute("about.html")).toBe("/about");
    expect(staticHtmlRoute("pricing/index.html")).toBe("/pricing");
  });
});

describe("inferRoutes", () => {
  it("dedupes routes touched by several files", () => {
    expect(routesOf(["src/app/page.tsx", "src/app/globals.css"])).toEqual([
      "/",
    ]);
  });

  it("skips tests, docs and build output", () => {
    expect(
      routesOf(["src/app/page.test.tsx", "README.md", "dist/index.html"]),
    ).toEqual(["/"]);
  });

  it("honours .proofshot.json routes over inference", () => {
    const routes = inferRoutes(["src/app/dashboard/page.tsx"], {
      config: { routes: ["/", "/pricing"] },
    });
    expect(routes.map((route) => route.route)).toEqual(["/", "/pricing"]);
    expect(routes[0]?.framework).toBe("config");
  });

  it("falls back to the home page when nothing route-like changed", () => {
    const routes = inferRoutes(["src/lib/format.ts"]);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.route).toBe("/");
    expect(routes[0]?.reason).toContain("no route-like change");
  });

  it("maps shared components and entries to the home page (Vite SPA)", () => {
    expect(routesOf(["src/App.tsx"])).toEqual(["/"]);
    expect(routesOf(["src/components/Button.tsx"])).toEqual(["/"]);
    expect(routesOf(["src/pages/UserSettings.tsx"])).toEqual([
      "/user-settings",
    ]);
  });

  it("reads src/pages as Next.js Pages Router in a Next project", () => {
    const routes = inferRoutes(["src/pages/about.tsx"], { nextProject: true });
    expect(routes.map((route) => route.route)).toEqual(["/about"]);
    expect(routes[0]?.framework).toBe("next-pages");
  });
});

describe("React Router", () => {
  it("parses JSX route declarations", () => {
    const source = `
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/settings" component={Settings} />
        <Route index element={<Home />} />
      </Routes>`;
    const routes = parseRouterSource(source, "src/App.tsx");
    expect(routes.map((route) => route.route)).toEqual([
      "/",
      "/pricing",
      "/settings",
    ]);
    expect(routes[0]?.component).toBe("Home");
    expect(routes[1]?.component).toBe("Pricing");
  });

  it("parses object route definitions", () => {
    const source = `
      const router = createBrowserRouter([
        { path: "/", element: <Dashboard /> },
        { path: "/pricing", element: <PricingPage /> },
        { path: "/login", Component: Login },
      ]);`;
    const routes = parseRouterSource(source, "src/router.tsx");
    expect(routes.map((route) => route.route)).toEqual([
      "/",
      "/pricing",
      "/login",
    ]);
    expect(routes[2]?.component).toBe("Login");
  });

  it("matches a changed component to the route that renders it", () => {
    const routerRoutes = parseRouterSource(
      `<Route path="/pricing" element={<Pricing />} />`,
      "src/App.tsx",
    );
    const routes = inferRoutes(["src/pages/Pricing.tsx"], { routerRoutes });
    expect(routes.map((route) => route.route)).toEqual(["/pricing"]);
    expect(routes[0]?.framework).toBe("react-router");
  });

  it("maps a changed router definition to all of its routes", () => {
    const routerRoutes = parseRouterSource(
      `<Route path="/" element={<Home />} /><Route path="/pricing" element={<Pricing />} />`,
      "src/App.tsx",
    );
    const routes = inferRoutes(["src/App.tsx"], { routerRoutes });
    expect(routes.map((route) => route.route)).toEqual(["/", "/pricing"]);
  });

  it("returns nothing for a project without router files", () => {
    expect(discoverRouterRoutes(process.cwd())).toEqual([]);
  });
});

describe("nested JSX React Router", () => {
  it("joins relative children and selects the real settings URL", () => {
    const r = parseRouterSource(
      `<Routes><Route path="/dashboard" element={<DashboardLayout />}><Route path="settings" element={<Settings />} /></Route></Routes>`,
      "src/App.tsx",
    );
    expect(
      inferRoutes(["src/pages/Settings.tsx"], { routerRoutes: r }).map(
        (x) => x.route,
      ),
    ).toEqual(["/dashboard/settings"]);
  });
  it("keeps index at its parent and pathless layouts transparent", () => {
    const r = parseRouterSource(
      `<Route path="/dashboard" element={<Layout />}><Route index element={<Overview />} /><Route element={<Auth />}><Route path="settings" element={<Settings />} /></Route></Route><Route path="/login" element={<Login />} />`,
      "src/App.tsx",
    );
    expect(
      inferRoutes(["src/pages/Overview.tsx"], { routerRoutes: r }).map(
        (x) => x.route,
      ),
    ).toEqual(["/dashboard"]);
    expect(
      inferRoutes(["src/pages/Settings.tsx"], { routerRoutes: r }).map(
        (x) => x.route,
      ),
    ).toEqual(["/dashboard/settings"]);
    expect(
      inferRoutes(["src/pages/Login.tsx"], { routerRoutes: r }).map(
        (x) => x.route,
      ),
    ).toEqual(["/login"]);
  });
  it("does not mistake quoted Route examples or JSX > expressions for tag boundaries", () => {
    const r = parseRouterSource(
      `const example='<Route path="/bad" />';<Route path="/dashboard" element={<Layout label={a > b ? 'x':'y'} />}><Route path={'settings'} element={<Settings />} /></Route>`,
      "src/App.tsx",
    );
    expect(r.map((x) => x.route)).toEqual([
      "/dashboard",
      "/dashboard/settings",
    ]);
  });
  it("refuses dynamic parents, spreads and invalid nested absolute paths with manual-route advice", () => {
    for (const source of [
      `<Route path={prefix}><Route path="settings" /></Route>`,
      `<Route {...routes}><Route path="settings" /></Route>`,
      `<Route path="/dashboard"><Route path="/settings" /></Route>`,
    ])
      expect(() => parseRouterSource(source, "src/App.tsx")).toThrow(
        ".proofshot.json",
      );
  });
});
