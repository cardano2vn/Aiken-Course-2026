"use client";

import { useEffect, useState } from "react";

export function useCurrentTime(): number | null {
    const [currentTime, setCurrentTime] = useState<number | null>(null);

    useEffect(() => {
        const intervalId = window.setInterval(() => setCurrentTime(Date.now()), 1_000);
        const timeoutId = window.setTimeout(() => setCurrentTime(Date.now()), 0);

        return () => {
            window.clearInterval(intervalId);
            window.clearTimeout(timeoutId);
        };
    }, []);

    return currentTime;
}
