import { MotionConfig } from "motion/react"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router"
import { TooltipProvider } from "@/components/ui/tooltip"
import "@fontsource-variable/inter/opsz.css"
import "@fontsource-variable/source-serif-4/opsz.css"
import "@fontsource-variable/source-serif-4/opsz-italic.css"
import { router } from "./app"
import "./styles.css"

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<MotionConfig reducedMotion="user">
			<TooltipProvider>
				<RouterProvider router={router} />
			</TooltipProvider>
		</MotionConfig>
	</StrictMode>,
)
