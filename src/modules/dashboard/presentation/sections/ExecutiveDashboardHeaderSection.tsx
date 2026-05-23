import BrandLockup from '../../../../components/BrandLockup'
import Card from '../../../../components/Card'

export function ExecutiveDashboardHeaderSection() {
  return (
    <Card className="relative overflow-hidden border-baby-300 bg-[linear-gradient(135deg,#001c29_0%,#01354d_34%,#01527d_72%,#1d8897_100%)] text-white shadow-[0_26px_50px_-34px_rgba(1,82,125,0.88)]">
      <img
        src={`${import.meta.env.BASE_URL}brand/orthoscan-mark-color.png`}
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute -right-8 -top-8 h-44 w-44 object-contain opacity-[0.14] blur-[0.5px]"
      />
      <div className="relative">
        <BrandLockup tone="light" size="sm" className="mb-4" showSubtitle={false} />
        <h1 className="text-3xl font-semibold">Dashboard</h1>
      </div>
    </Card>
  )
}
