<?php

namespace Tests\Unit;

use App\Models\Order;
use App\Models\OrderLine;
use App\Observers\OrderLineObserver;
use App\Services\AuditServiceInterface;
use App\Services\DateContainmentValidator;
use App\Services\LoopTemplateGeneratorInterface;
use Tests\TestCase;

class PaceEnforcementTest extends TestCase
{
    private OrderLineObserver $observer;

    protected function setUp(): void
    {
        parent::setUp();
        $generator = $this->createMock(LoopTemplateGeneratorInterface::class);
        $auditService = $this->createMock(AuditServiceInterface::class);
        $this->observer = new OrderLineObserver(new DateContainmentValidator(), $generator, $auditService);
    }

    private function makeOrderLine(string $priorityTier, string $deliveryPace): OrderLine
    {
        $orderLine = new OrderLine();
        $orderLine->order_id = fake()->uuid();
        $orderLine->name = 'Test Line';
        $orderLine->priority_tier = $priorityTier;
        $orderLine->delivery_pace = $deliveryPace;
        $orderLine->starts_at = '2025-01-01';
        $orderLine->ends_at = '2025-12-31';
        $orderLine->target_spots = 100;
        $orderLine->setRelation('order', new Order());

        return $orderLine;
    }

    // ─── Patrocinio tier: always forced to "uniform" ──

    public function test_patrocinio_forces_uniform_on_create_when_asap(): void
    {
        $orderLine = $this->makeOrderLine('patrocinio', 'asap');

        $this->observer->creating($orderLine);

        $this->assertEquals('uniform', $orderLine->delivery_pace);
    }

    public function test_patrocinio_keeps_uniform_on_create(): void
    {
        $orderLine = $this->makeOrderLine('patrocinio', 'uniform');

        $this->observer->creating($orderLine);

        $this->assertEquals('uniform', $orderLine->delivery_pace);
    }

    public function test_patrocinio_forces_uniform_on_update_when_asap(): void
    {
        $orderLine = $this->makeOrderLine('patrocinio', 'uniform');
        $orderLine->syncOriginal();
        $orderLine->delivery_pace = 'asap';

        $this->observer->updating($orderLine);

        $this->assertEquals('uniform', $orderLine->delivery_pace);
    }

    // ─── Red Interna tier: always forced to "uniform" ──

    public function test_red_interna_forces_uniform_on_create_when_asap(): void
    {
        $orderLine = $this->makeOrderLine('red_interna', 'asap');

        $this->observer->creating($orderLine);

        $this->assertEquals('uniform', $orderLine->delivery_pace);
    }

    public function test_red_interna_keeps_uniform_on_create(): void
    {
        $orderLine = $this->makeOrderLine('red_interna', 'uniform');

        $this->observer->creating($orderLine);

        $this->assertEquals('uniform', $orderLine->delivery_pace);
    }

    public function test_red_interna_forces_uniform_on_update_when_asap(): void
    {
        $orderLine = $this->makeOrderLine('red_interna', 'uniform');
        $orderLine->syncOriginal();
        $orderLine->delivery_pace = 'asap';

        $this->observer->updating($orderLine);

        $this->assertEquals('uniform', $orderLine->delivery_pace);
    }

    // ─── Estandar tier: allows "asap" or "uniform" ──

    public function test_estandar_allows_asap(): void
    {
        $orderLine = $this->makeOrderLine('estandar', 'asap');

        $this->observer->creating($orderLine);

        $this->assertEquals('asap', $orderLine->delivery_pace);
    }

    public function test_estandar_allows_uniform(): void
    {
        $orderLine = $this->makeOrderLine('estandar', 'uniform');

        $this->observer->creating($orderLine);

        $this->assertEquals('uniform', $orderLine->delivery_pace);
    }

    public function test_estandar_defaults_invalid_pace_to_uniform(): void
    {
        $orderLine = $this->makeOrderLine('estandar', 'invalid_pace');

        $this->observer->creating($orderLine);

        $this->assertEquals('uniform', $orderLine->delivery_pace);
    }

    public function test_estandar_allows_changing_from_uniform_to_asap_on_update(): void
    {
        $orderLine = $this->makeOrderLine('estandar', 'uniform');
        $orderLine->syncOriginal();
        $orderLine->delivery_pace = 'asap';

        $this->observer->updating($orderLine);

        $this->assertEquals('asap', $orderLine->delivery_pace);
    }
}
