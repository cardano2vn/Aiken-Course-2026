import { docs } from "../../.source/server";
import { loader } from "fumadocs-core/source";
import { routers } from "@/constants/routers";

export const source = loader({
    baseUrl: routers.documentation,
    source: docs.toFumadocsSource(),
});
