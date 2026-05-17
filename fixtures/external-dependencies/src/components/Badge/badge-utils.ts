import clsx from "clsx";

export const decorate = (value: unknown) => clsx("badge", String(value));
