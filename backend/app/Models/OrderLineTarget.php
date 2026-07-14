<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class OrderLineTarget extends Model
{
    use HasFactory, HasUuids;

    /**
     * Indicates that the model's ID is not auto-incrementing.
     */
    public $incrementing = false;

    /**
     * The data type of the primary key.
     */
    protected $keyType = 'string';

    /**
     * Indicates if the model should be timestamped.
     */
    public $timestamps = false;

    /**
     * The name of the "created at" column.
     */
    const CREATED_AT = 'created_at';

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'order_line_id',
        'screen_id',
        'screen_group_id',
    ];

    /**
     * The "booted" method of the model.
     * Registers XOR validation: exactly one of screen_id or screen_group_id must be present.
     */
    protected static function booted(): void
    {
        static::saving(function (OrderLineTarget $target) {
            $hasScreen = !is_null($target->screen_id);
            $hasGroup = !is_null($target->screen_group_id);

            if ($hasScreen === $hasGroup) {
                throw new \Illuminate\Validation\ValidationException(
                    validator([], []),
                    new \Illuminate\Http\JsonResponse([
                        'message' => 'Exactly one of screen_id or screen_group_id must be provided.',
                    ], 422)
                );
            }
        });
    }

    /**
     * Get the order line that owns this target.
     */
    public function orderLine()
    {
        return $this->belongsTo(OrderLine::class);
    }

    /**
     * Get the screen targeted (nullable).
     */
    public function screen()
    {
        return $this->belongsTo(Screen::class);
    }

    /**
     * Get the screen group targeted (nullable).
     */
    public function screenGroup()
    {
        return $this->belongsTo(ScreenGroup::class);
    }

    /**
     * Get the creatives assigned to this target.
     */
    public function creatives()
    {
        return $this->hasMany(Creative::class);
    }
}
