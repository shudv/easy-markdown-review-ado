import type { ReactElement } from "react";

interface IconProps {
    size?: number;
    className?: string;
}

const strokeProps = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
};

function iconClassName(className: string | undefined): string {
    return className !== undefined && className !== "" ? `emr-ui-icon ${className}` : "emr-ui-icon";
}

export function SearchIcon({ size = 16, className }: Readonly<IconProps>): ReactElement {
    return (
        <svg
            className={iconClassName(className)}
            viewBox="0 0 24 24"
            width={size}
            height={size}
            aria-hidden="true"
            focusable="false"
            {...strokeProps}
        >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
        </svg>
    );
}

export function PlusIcon({ size = 16, className }: Readonly<IconProps>): ReactElement {
    return (
        <svg
            className={iconClassName(className)}
            viewBox="0 0 24 24"
            width={size}
            height={size}
            aria-hidden="true"
            focusable="false"
            {...strokeProps}
        >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
        </svg>
    );
}

/** An arrow leaving a box: the action opens somewhere else (a new tab). */
export function OpenElsewhereIcon({ size = 16, className }: Readonly<IconProps>): ReactElement {
    return (
        <svg
            className={iconClassName(className)}
            viewBox="0 0 24 24"
            width={size}
            height={size}
            aria-hidden="true"
            focusable="false"
            {...strokeProps}
        >
            <path d="M14 4h6v6" />
            <path d="M20 4 11 13" />
            <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
        </svg>
    );
}
