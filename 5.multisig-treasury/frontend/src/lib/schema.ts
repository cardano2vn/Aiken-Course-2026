import { z } from "zod";

export const TreasurySchema = z.object({
    title: z.string().min(1, "Title is required").max(100, "Title must be 100 characters or less"),
    description: z.string().min(1, "Description is required").max(500, "Description must be 500 characters or less"),
    receiver: z.string().min(1, "Receiver is required").max(500, "Receiver must be 50 characters or less"),
    image: z.string().url("Must be a valid URL").optional().or(z.literal("")),
    threshold: z.number().min(2, "At least 2 participant is required").max(1000, "Participants cannot exceed 1000"),
    allowance: z.number().min(0, "At least 2 participant is required"),
    owners: z.string().refine(
        (val) => {
            const addrs = val
                .split(",")
                .map((a) => a.trim())
                .filter(Boolean);
            return addrs.length >= 2 && addrs.every((a) => a.startsWith("addr1") || a.startsWith("addr_test"));
        },
        { message: "At least 2 valid Cardano addresses required" },
    ),
});
