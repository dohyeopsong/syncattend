import { DashboardLayout } from "@/components/DashboardLayout";
import { CoursePanel } from "@/components/CoursePanel";
import { QrSessionModal } from "@/components/QrSessionModal";
import { SimulationPanel } from "@/components/SimulationPanel";
import { AttendanceTable } from "@/components/AttendanceTable";
import { useSessionStore } from "@/store/session";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

export function DashboardPage() {
  const reviewOpen = useSessionStore((s) => s.reviewOpen);
  const closeReview = useSessionStore((s) => s.closeReview);

  return (
    <DashboardLayout>
      {/* Course management + "세션 열기". Opening a session pops the QR modal
          (QrSessionModal) which carries the SSE realtime panel above the QR. */}
      <section id="courses" className="scroll-mt-20">
        <CoursePanel />
      </section>

      {/* Verification simulation */}
      <section id="simulation" className="scroll-mt-20">
        <SimulationPanel />
      </section>

      {/* QR + SSE popup: appears automatically while a session is open. */}
      <QrSessionModal />

      {/* 결석자 검토: 세션 닫기 / 인증 창 만료 시 팝업으로 노출 */}
      {reviewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="review-title"
          onClick={closeReview}
        >
          <div
            className="my-4 w-full max-w-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={closeReview}
                aria-label="결석자 검토 닫기"
              >
                <X className="h-4 w-4" /> 닫기
              </Button>
            </div>
            <AttendanceTable />
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
