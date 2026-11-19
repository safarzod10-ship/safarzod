package com.safarzod.jarvis.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class MemoryTest {

    private fun memory() = Memory(RuntimeEnvironment.getApplication()).also { m -> m.items.value.forEach { m.removeExact(it) } }

    @Test fun storesBaseFormAndFindsAnyCase() {
        val m = memory()
        m.put("маме", AliasKind.CONTACT, "Mom", "+79161234567")
        assertEquals("мама", m.items.value.single().alias)
        for (q in listOf("мама", "маме", "маму", "мамы", "Мамой")) assertNotNull(q, m.find(q, AliasKind.CONTACT))
        assertNull(m.find("папе", AliasKind.CONTACT))
    }

    @Test fun overwriteAndForget() {
        val m = memory()
        m.put("брат", AliasKind.CONTACT, "Артём", "1")
        m.put("брату", AliasKind.CONTACT, "Артём Новый", "2")
        assertEquals(1, m.items.value.size)
        assertEquals("Артём Новый", m.find("брата", AliasKind.CONTACT)!!.title)
        assertNotNull(m.remove("брату"))
        assertNull(m.find("брат", AliasKind.CONTACT))
    }

    @Test fun appsAndContactsAreSeparate() {
        val m = memory()
        m.put("телега", AliasKind.APP, "Telegram", "org.telegram.messenger")
        assertNull(m.find("телега", AliasKind.CONTACT))
        assertEquals("org.telegram.messenger", m.find("телегу", AliasKind.APP)!!.value)
    }
}
