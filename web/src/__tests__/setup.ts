// Global Vitest setup. Registers @testing-library/jest-dom matchers
// (toBeInTheDocument, toHaveTextContent, …) for component tests. Safe in the
// node env too — it only augments `expect`; DOM matchers are exercised only by
// jsdom-environment files.
import "@testing-library/jest-dom/vitest";
